// Pruebas de integración contra SQL Server. Requieren TEST_DATABASE_URL (en CI lo provee un contenedor SQL Server).
// La base indicada se BORRA y se recrea en cada corrida: no apunte nunca a una base real.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Maestros, ResultadoSync } from '@shared/dominio';
import { crearApp, hoyLocal } from '../src/app';
import { crearPool, type Db } from '../src/db';
import { ejecutarScript, migrar } from '../src/migraciones';

const url = process.env.TEST_DATABASE_URL;
const dbDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db');

describe.skipIf(!url)('API con base de datos', () => {
  let db: Db;
  let app: FastifyInstance;
  const tokens: Record<string, string> = {};
  let maestros: Maestros;

  const pedir = (doc: string, method: 'GET' | 'POST' | 'PATCH', ruta: string, payload?: unknown) =>
    app.inject({
      method,
      url: ruta,
      payload: payload as object,
      headers: { authorization: `Bearer ${tokens[doc]}` },
    });

  const sync = async (doc: string, operaciones: unknown[]) => {
    const r = await pedir(doc, 'POST', '/api/sync', { operaciones });
    expect(r.statusCode).toBe(200);
    return r.json<ResultadoSync>();
  };

  const punto = (codigo: string) => maestros.puntos.find((p) => p.codigo === codigo)!.id;
  const t0 = Date.now(); // una sola referencia: las diferencias entre horas son exactas
  const hace = (min: number) => new Date(t0 - min * 60_000).toISOString();

  beforeAll(async () => {
    // Recrea la base de pruebas desde master.
    const nombre = /Database=([^;]+)/i.exec(url!)?.[1];
    if (!nombre || !/^\w+_test$/.test(nombre))
      throw new Error('TEST_DATABASE_URL debe apuntar a una base *_test');
    const master = crearPool(url!.replace(/Database=[^;]+/i, 'Database=master'));
    await master.query(
      `IF DB_ID('${nombre}') IS NOT NULL ALTER DATABASE [${nombre}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
       DROP DATABASE IF EXISTS [${nombre}]; CREATE DATABASE [${nombre}];`,
    );
    await master.end();
    db = crearPool(url!);
    await migrar(db, path.join(dbDir, 'migrations'));
    await ejecutarScript(db, await readFile(path.join(dbDir, 'demo/demo.sql'), 'utf8'));
    app = await crearApp({ db, jwtSecret: 'prueba' });
    for (const doc of ['100', '101', '110', '111', '112', '113', '114']) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/sesion',
        payload: { documento: doc, pin: '1234' },
      });
      expect(r.statusCode).toBe(200);
      tokens[doc] = r.json().token;
    }
    maestros = (await pedir('113', 'GET', '/api/maestros')).json();
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  it('rechaza un PIN incorrecto', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sesion',
      payload: { documento: '113', pin: '9999' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/maestros' })).statusCode).toBe(401);
  });

  it('entrega maestros de la sede y sugiere la poscosecha más cercana', () => {
    expect(maestros.sedes.map((s) => s.id)).toEqual(['OL']);
    expect(maestros.destino_sugerido[punto('B1')]).toBe(punto('POS1'));
    expect(maestros.destino_sugerido[punto('B4')]).toBe(punto('POS2'));
  });

  it('registra el ciclo completo: llamado, viaje, eventos, recibo y tablero', async () => {
    const llamado = randomUUID();
    const r1 = await sync('111', [
      {
        tipo: 'llamado',
        id: llamado,
        bloque_id: punto('B1'),
        producto: 'flor',
        cantidad_estimada: 1,
        creado_en: hace(60),
      },
    ]);
    expect(r1.aplicadas).toEqual([llamado]);

    const cola = (await pedir('113', 'GET', '/api/llamados')).json();
    expect(cola).toHaveLength(1);

    const turno = randomUUID();
    const viaje = randomUUID();
    const evento = (e: string, min: number) => ({
      tipo: 'evento',
      id: randomUUID(),
      viaje_id: viaje,
      evento: e,
      ocurrido_en: hace(min),
    });
    const ops = [
      { tipo: 'turno_inicio', id: turno, recurso_id: maestros.recursos[0]!.id, inicio: hace(120) },
      {
        tipo: 'viaje',
        id: viaje,
        turno_id: turno,
        recurso_id: maestros.recursos[0]!.id,
        llamado_id: llamado,
        origen_id: punto('B1'),
        destino_id: punto('POS1'),
        producto: 'flor',
        cantidad: 1,
        unidad: 'garrucha',
        creado_en: hace(55),
      },
      evento('llegada_bloque', 55), // respuesta al llamado: 5 min
      evento('salida_bloque', 45), // 10 min en bloque → 5 de espera
      evento('llegada_destino', 39),
      evento('fin_descargue', 32), // 7 min → 2 de espera en descargue
      evento('regreso', 25), // ciclo: 30 min
    ];
    const r2 = await sync('113', ops);
    expect(r2.rechazadas).toEqual([]);
    expect(r2.aplicadas).toHaveLength(ops.length);

    // Reenviar el mismo lote (teléfono que perdió la respuesta) no duplica nada.
    const r3 = await sync('113', ops);
    expect(r3.aplicadas).toHaveLength(ops.length);
    expect((await db.query('SELECT COUNT(*) AS n FROM evento_viaje')).rows[0].n).toBe(5);

    const recibo = await sync('112', [
      {
        tipo: 'recibo',
        id: randomUUID(),
        viaje_id: viaje,
        cantidad: 1,
        novedad: null,
        ocurrido_en: hace(32),
      },
    ]);
    expect(recibo.rechazadas).toEqual([]);

    expect((await pedir('113', 'GET', '/api/llamados')).json()).toHaveLength(0); // llamado atendido

    // Fecha local del viaje (evita fallas si la prueba corre cerca de medianoche).
    const fecha = hoyLocal('-05:00', new Date(t0 - 55 * 60_000));
    const t = (await pedir('110', 'GET', `/api/tablero?fecha=${fecha}`)).json();
    expect(t.viajes_entregados).toBe(1);
    expect(t.ciclo_promedio_min).toBeCloseTo(30, 5);
    expect(t.ciclo_estandar_promedio_min).toBeCloseTo((2 * 300) / 55 + 10, 1);
    expect(t.respuesta_llamado_promedio_min).toBeCloseTo(5, 5);
    expect(t.espera_descargue_promedio_min).toBeCloseTo(2, 5);
  });

  it('aplica permisos por rol y por sede', async () => {
    // Un transportador no puede crear llamados.
    const r = await sync('113', [
      {
        tipo: 'llamado',
        id: randomUUID(),
        bloque_id: punto('B2'),
        producto: 'flor',
        cantidad_estimada: 1,
        creado_en: hace(1),
      },
    ]);
    expect(r.rechazadas).toHaveLength(1);

    // Un transportador no registra eventos en el viaje de otro.
    const viaje = randomUUID();
    await sync('114', [
      {
        tipo: 'viaje',
        id: viaje,
        turno_id: null,
        recurso_id: null,
        llamado_id: null,
        origen_id: punto('B2'),
        destino_id: punto('POS1'),
        producto: 'flor',
        cantidad: 1,
        unidad: 'garrucha',
        creado_en: hace(5),
      },
    ]);
    const ajeno = await sync('113', [
      { tipo: 'evento', id: randomUUID(), viaje_id: viaje, evento: 'llegada_bloque', ocurrido_en: hace(4) },
    ]);
    expect(ajeno.rechazadas[0]?.motivo).toMatch(/otro transportador/);

    // El tablero no está disponible para transportadores; gerencia ve todas las sedes.
    expect((await pedir('113', 'GET', '/api/tablero')).statusCode).toBe(403);
    expect((await pedir('101', 'GET', '/api/tablero/sedes')).json()).toHaveLength(3);
  });

  it('rechaza horas del teléfono adelantadas y una operación mala no bloquea las demás', async () => {
    const buena = randomUUID();
    const r = await sync('113', [
      {
        tipo: 'turno_inicio',
        id: randomUUID(),
        recurso_id: null,
        inicio: new Date(Date.now() + 3_600_000).toISOString(),
      },
      {
        tipo: 'falla',
        id: buena,
        recurso_id: null,
        punto_id: punto('B3'),
        tipo_falla: 'tramo_bloqueado',
        descripcion: 'Rama en el cable',
        inicio: hace(2),
      },
    ]);
    expect(r.rechazadas[0]?.motivo).toMatch(/adelantada/);
    expect(r.aplicadas).toEqual([buena]);
    expect((await pedir('110', 'GET', '/api/fallas')).json()).toHaveLength(1);
  });

  it('exporta CSV para el jefe de sede', async () => {
    const r = await pedir('110', 'GET', '/api/exportar/viajes.csv');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.body.split('\r\n')[0]).toContain('llegada_bloque');
  });

  it('el jefe de sede solo crea usuarios operativos de su sede', async () => {
    const ok = await pedir('110', 'POST', '/api/usuarios', {
      documento: '9001',
      nombre: 'Nuevo transportador',
      rol: 'transportador',
      sede_id: 'OL',
      pin: '4321',
    });
    expect(ok.statusCode).toBe(201);
    const no = await pedir('110', 'POST', '/api/usuarios', {
      documento: '9002',
      nombre: 'Otro jefe',
      rol: 'jefe_sede',
      sede_id: 'MT',
      pin: '4321',
    });
    expect(no.statusCode).toBe(403);
  });

  it('el anotador despacha por el transportador y las lecturas de poscosecha se emparejan', async () => {
    const transportador = maestros.transportadores.find((t) => t.nombre === 'Transportador uno')!;
    const llamado = randomUUID();
    const viaje = randomUUID();
    const r = await sync('111', [
      {
        tipo: 'llamado',
        id: llamado,
        bloque_id: punto('B3'),
        producto: 'flor',
        cantidad_estimada: 1,
        creado_en: hace(50),
      },
      {
        tipo: 'viaje',
        id: viaje,
        transportador_id: transportador.id,
        turno_id: null,
        recurso_id: null,
        llamado_id: llamado,
        origen_id: punto('B3'),
        destino_id: punto('POS2'),
        producto: 'flor',
        cantidad: 12,
        unidad: 'balde',
        contenido: [
          { cuenta: 'C01', baldes: 8 },
          { cuenta: 'C02', baldes: 4 },
        ],
        creado_en: hace(44),
      },
      { tipo: 'evento', id: randomUUID(), viaje_id: viaje, evento: 'llegada_bloque', ocurrido_en: hace(44) },
      { tipo: 'evento', id: randomUUID(), viaje_id: viaje, evento: 'salida_bloque', ocurrido_en: hace(30) },
    ]);
    expect(r.rechazadas).toEqual([]);

    const lecturas = {
      archivo: 'lecturas_prueba.csv',
      lecturas: [
        {
          codigo_transportador: 'T113',
          baldes: 11,
          ocurrido_en: hace(22),
          novedad: 'Un balde con tallo corto',
        },
        { codigo_transportador: 'T999', baldes: 5, ocurrido_en: hace(20), novedad: null },
      ],
    };
    const imp = await pedir('110', 'POST', '/api/lecturas', lecturas);
    expect(imp.statusCode).toBe(200);
    expect(imp.json()).toMatchObject({ leidas: 2, nuevas: 2, emparejadas: 1, sin_transportador: ['T999'] });

    // Reimportar el mismo archivo no duplica.
    expect((await pedir('110', 'POST', '/api/lecturas', lecturas)).json()).toMatchObject({
      nuevas: 0,
      emparejadas: 0,
    });

    const ev = await db.query(
      `SELECT origen FROM evento_viaje WHERE viaje_id = $1 AND tipo = 'llegada_destino'`,
      [viaje],
    );
    expect(ev.rows[0]?.origen).toBe('lectura_poscosecha');

    const fecha = hoyLocal('-05:00', new Date(t0 - 44 * 60_000));
    const t = (await pedir('110', 'GET', `/api/tablero?fecha=${fecha}`)).json();
    expect(t.baldes_anotados).toBe(12);
    expect(t.baldes_recibidos).toBe(11);
  });

  it('un transportador no puede importar lecturas', async () => {
    const r = await pedir('113', 'POST', '/api/lecturas', {
      archivo: null,
      lecturas: [{ codigo_transportador: 'T113', baldes: 1, ocurrido_en: hace(1), novedad: null }],
    });
    expect(r.statusCode).toBe(403);
  });
});
