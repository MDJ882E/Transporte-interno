import type { FastifyInstance } from 'fastify';
import type { Indicadores, TipoEvento } from '@shared/dominio';
import { hoyLocal, sedeConsulta, ventanaDia } from '../app';
import { EVENTOS_JSON, leerEventos } from './consulta';
import { calcularIndicadores, type ViajeEntrada } from '../indicadores';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function indicadoresSede(
  app: FastifyInstance,
  sede: string,
  fecha: string,
): Promise<Indicadores | null> {
  const s = await app.db.query(
    'SELECT min_cargue_estandar, min_descargue_estandar, horas_jornada FROM sede WHERE id = $1',
    [sede],
  );
  const p = s.rows[0];
  if (!p) return null;
  const { desde, hasta } = ventanaDia(fecha, app.offsetZona);

  const [viajes, turnos, fallas, recursos, conciliacion] = await Promise.all([
    app.db.query<{
      id: string;
      transportador_id: number;
      bloque: string;
      llamado_creado_en: Date | null;
      ciclo_estandar_min: number | null;
      eventos: string | null;
    }>(
      `SELECT v.id, v.transportador_id, o.nombre AS bloque, l.creado_en AS llamado_creado_en, x.ciclo_estandar_min,
              ${EVENTOS_JSON} AS eventos
       FROM viaje v
       JOIN punto o ON o.id = v.origen_id
       LEFT JOIN llamado l ON l.id = v.llamado_id
       LEFT JOIN distancia x ON x.origen_id = v.origen_id AND x.destino_id = v.destino_id
       WHERE v.sede_id = $1 AND v.creado_en >= $2 AND v.creado_en < $3 AND v.anulado = 0`,
      [sede, desde, hasta],
    ),
    app.db.query(
      `SELECT usuario_id, inicio, fin FROM turno
       WHERE sede_id = $1 AND inicio < $3 AND (fin IS NULL OR fin > $2)`,
      [sede, desde, hasta],
    ),
    app.db.query(
      `SELECT inicio, fin FROM falla
       WHERE sede_id = $1 AND recurso_id IS NOT NULL AND inicio < $3 AND (fin IS NULL OR fin > $2)`,
      [sede, desde, hasta],
    ),
    app.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM recurso WHERE sede_id = $1 AND activo = 1', [
      sede,
    ]),
    // Baldes anotados en el bloque frente a los leídos en poscosecha, para los viajes del día.
    app.db.query<{ anotados: number; recibidos: number; sin_emparejar: number }>(
      `SELECT
         (SELECT COALESCE(SUM(c.baldes), 0) FROM viaje_contenido c JOIN viaje v ON v.id = c.viaje_id
           WHERE v.sede_id = $1 AND v.creado_en >= $2 AND v.creado_en < $3 AND v.anulado = 0) AS anotados,
         (SELECT COALESCE(SUM(l.baldes), 0) FROM lectura_poscosecha l JOIN viaje v ON v.id = l.viaje_id
           WHERE v.sede_id = $1 AND v.creado_en >= $2 AND v.creado_en < $3 AND v.anulado = 0) AS recibidos,
         (SELECT COUNT(*) FROM lectura_poscosecha l
           WHERE l.sede_id = $1 AND l.ocurrido_en >= $2 AND l.ocurrido_en < $3 AND l.viaje_id IS NULL) AS sin_emparejar`,
      [sede, desde, hasta],
    ),
  ]);

  const entrada: ViajeEntrada[] = viajes.rows.map((v) => ({
    id: v.id,
    transportador_id: v.transportador_id,
    bloque: v.bloque,
    llamado_creado_en: v.llamado_creado_en,
    ciclo_estandar_min: v.ciclo_estandar_min,
    eventos: Object.fromEntries(
      Object.entries(leerEventos(v.eventos)).map(([k, t]) => [k as TipoEvento, new Date(t)]),
    ) as ViajeEntrada['eventos'],
  }));

  return calcularIndicadores(
    {
      sede_id: sede,
      fecha,
      min_cargue_estandar: p.min_cargue_estandar,
      min_descargue_estandar: p.min_descargue_estandar,
      horas_jornada: p.horas_jornada,
      ventana_inicio: desde,
      ventana_fin: hasta,
      ahora: new Date(),
    },
    entrada,
    turnos.rows,
    fallas.rows,
    Number(recursos.rows[0]?.n ?? 0),
    {
      baldes_anotados: conciliacion.rows[0]?.anotados ?? 0,
      baldes_recibidos: conciliacion.rows[0]?.recibidos ?? 0,
      lecturas_sin_emparejar: conciliacion.rows[0]?.sin_emparejar ?? 0,
    },
  );
}

function csv(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const t = valor instanceof Date ? valor.toISOString() : String(valor);
  // Evita que Excel interprete el contenido como fórmula.
  const seguro = /^[=+\-@]/.test(t) ? `'${t}` : t;
  return /[;"\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export async function rutasTablero(app: FastifyInstance) {
  const lectores = app.requiere('lider_corte', 'jefe_sede', 'gerencia', 'admin');

  app.get('/api/tablero', { preHandler: lectores }, async (req, rep) => {
    const q = req.query as { sede?: string; fecha?: string };
    const sede = sedeConsulta(req.user, q.sede);
    const fecha = q.fecha ?? hoyLocal(app.offsetZona);
    if (!sede || !FECHA.test(fecha))
      return rep.code(400).send({ error: 'Indique sede y fecha (AAAA-MM-DD).' });
    const r = await indicadoresSede(app, sede, fecha);
    return r ?? rep.code(404).send({ error: 'Sede no encontrada.' });
  });

  // Comparativo de todas las sedes para gerencia.
  app.get('/api/tablero/sedes', { preHandler: app.requiere('gerencia', 'admin') }, async (req, rep) => {
    const fecha = (req.query as { fecha?: string }).fecha ?? hoyLocal(app.offsetZona);
    if (!FECHA.test(fecha)) return rep.code(400).send({ error: 'Fecha inválida (AAAA-MM-DD).' });
    const sedes = await app.db.query<{ id: string }>('SELECT id FROM sede ORDER BY id');
    const r = await Promise.all(sedes.rows.map((s) => indicadoresSede(app, s.id, fecha)));
    return r.filter(Boolean);
  });

  // Exportación de viajes con sus eventos a CSV (se abre en Excel). Separador ';' por la configuración regional.
  app.get(
    '/api/exportar/viajes.csv',
    { preHandler: app.requiere('jefe_sede', 'gerencia', 'admin') },
    async (req, rep) => {
      const q = req.query as { sede?: string; desde?: string; hasta?: string };
      const sede = sedeConsulta(req.user, q.sede);
      const hoy = hoyLocal(app.offsetZona);
      const d = q.desde ?? hoy;
      const h = q.hasta ?? d;
      if (!sede || !FECHA.test(d) || !FECHA.test(h) || h < d) {
        return rep.code(400).send({ error: 'Indique sede, desde y hasta (AAAA-MM-DD).' });
      }
      const desde = ventanaDia(d, app.offsetZona).desde;
      const hasta = ventanaDia(h, app.offsetZona).hasta;
      if (hasta.getTime() - desde.getTime() > 93 * 86_400_000) {
        return rep.code(400).send({ error: 'El rango máximo es de 93 días.' });
      }
      const r = await app.db.query(
        `SELECT v.id, v.sede_id, u.nombre AS transportador, rc.codigo AS recurso, o.nombre AS origen,
                d.nombre AS destino, v.producto, v.cantidad, v.unidad, x.metros, x.ciclo_estandar_min,
                CAST(CASE WHEN v.llamado_id IS NULL THEN 0 ELSE 1 END AS BIT) AS con_llamado, l.creado_en AS hora_llamado,
                (SELECT ocurrido_en FROM evento_viaje e WHERE e.viaje_id = v.id AND e.tipo = 'llegada_bloque') AS llegada_bloque,
                (SELECT ocurrido_en FROM evento_viaje e WHERE e.viaje_id = v.id AND e.tipo = 'salida_bloque') AS salida_bloque,
                (SELECT ocurrido_en FROM evento_viaje e WHERE e.viaje_id = v.id AND e.tipo = 'llegada_destino') AS llegada_destino,
                (SELECT ocurrido_en FROM evento_viaje e WHERE e.viaje_id = v.id AND e.tipo = 'fin_descargue') AS fin_descargue,
                (SELECT ocurrido_en FROM evento_viaje e WHERE e.viaje_id = v.id AND e.tipo = 'regreso') AS regreso,
                rb.cantidad AS cantidad_recibida, rb.novedad
         FROM viaje v
         JOIN usuario u ON u.id = v.transportador_id
         JOIN punto o ON o.id = v.origen_id
         JOIN punto d ON d.id = v.destino_id
         LEFT JOIN recurso rc ON rc.id = v.recurso_id
         LEFT JOIN llamado l ON l.id = v.llamado_id
         LEFT JOIN distancia x ON x.origen_id = v.origen_id AND x.destino_id = v.destino_id
         LEFT JOIN recibo rb ON rb.viaje_id = v.id
         WHERE v.sede_id = $1 AND v.creado_en >= $2 AND v.creado_en < $3 AND v.anulado = 0
         ORDER BY v.creado_en`,
        [sede, desde, hasta],
      );
      const columnas = r.columnas;
      const lineas = [columnas.join(';'), ...r.rows.map((f) => columnas.map((c) => csv(f[c])).join(';'))];
      return rep
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="viajes_${sede}_${d}_${h}.csv"`)
        .send('﻿' + lineas.join('\r\n'));
    },
  );
}
