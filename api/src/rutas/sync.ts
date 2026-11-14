import type { FastifyInstance } from 'fastify';
import { LoteSyncSchema, type Operacion, type ResultadoSync, type Rol } from '@shared/dominio';
import { enTransaccion, type Cliente } from '../db';
import type { UsuarioToken } from '../app';

/** Quién puede enviar cada tipo de operación. */
const PERMISOS: Record<Operacion['tipo'], readonly Rol[]> = {
  turno_inicio: ['transportador', 'jefe_sede'],
  turno_fin: ['transportador', 'jefe_sede'],
  // El líder de corte actúa como anotador del bloque cuando el transportador no lleva teléfono.
  viaje: ['transportador', 'lider_corte', 'jefe_sede'],
  evento: ['transportador', 'lider_corte', 'jefe_sede'],
  contenido: ['transportador', 'lider_corte', 'jefe_sede'],
  espera_inicio: ['transportador', 'jefe_sede'],
  espera_fin: ['transportador', 'jefe_sede'],
  llamado: ['lider_corte', 'jefe_sede'],
  llamado_cancelar: ['lider_corte', 'jefe_sede'],
  recibo: ['recibidor', 'jefe_sede'],
  falla: ['transportador', 'lider_corte', 'recibidor', 'jefe_sede'],
  falla_fin: ['transportador', 'lider_corte', 'recibidor', 'jefe_sede'],
};

/** Una hora del teléfono se acepta si no está en el futuro (+10 min de tolerancia) ni tiene más de 72 h. */
const TOLERANCIA_FUTURO = 10 * 60_000;
const MAX_ANTIGUEDAD = 72 * 3_600_000;

class Rechazo extends Error {}

function validarHora(iso: string, ahora: number) {
  const t = Date.parse(iso);
  if (t > ahora + TOLERANCIA_FUTURO)
    throw new Rechazo('La hora del teléfono está adelantada; revise la hora del equipo.');
  if (t < ahora - MAX_ANTIGUEDAD)
    throw new Rechazo('Registro con más de 72 horas; debe corregirlo el jefe de sede.');
}

async function exigirPunto(c: Cliente, id: number, sede: string, tipos?: string[]) {
  const r = await c.query('SELECT tipo FROM punto WHERE id = $1 AND sede_id = $2 AND activo', [id, sede]);
  const tipo = r.rows[0]?.tipo as string | undefined;
  if (!tipo) throw new Rechazo(`El punto ${id} no pertenece a la sede.`);
  if (tipos && !tipos.includes(tipo)) throw new Rechazo(`El punto ${id} no es de tipo ${tipos.join(' o ')}.`);
}

async function exigirRecurso(c: Cliente, id: number | null, sede: string) {
  if (id === null) return;
  const r = await c.query('SELECT 1 FROM recurso WHERE id = $1 AND sede_id = $2', [id, sede]);
  if (!r.rowCount) throw new Rechazo(`El recurso ${id} no pertenece a la sede.`);
}

/** El viaje debe existir en la sede y, para un transportador, ser suyo. */
async function exigirViaje(c: Cliente, id: string, u: UsuarioToken, propio: boolean) {
  const r = await c.query<{ transportador_id: number }>(
    'SELECT transportador_id FROM viaje WHERE id = $1 AND sede_id = $2',
    [id, u.sede_id],
  );
  const v = r.rows[0];
  if (!v) throw new Rechazo('El viaje no existe en la sede (¿se envió primero el viaje?).');
  if (propio && u.rol === 'transportador' && v.transportador_id !== u.id)
    throw new Rechazo('El viaje es de otro transportador.');
}

async function guardarContenido(
  c: Cliente,
  viajeId: string,
  contenido: { cuenta: string; baldes: number }[],
) {
  const cuentas = [...new Set(contenido.map((x) => x.cuenta))];
  const validas = await c.query('SELECT codigo FROM cuenta WHERE codigo = ANY($1) AND activo', [cuentas]);
  const faltan = cuentas.filter((k) => !validas.rows.some((r) => r.codigo === k));
  if (faltan.length) throw new Rechazo(`Cuenta desconocida: ${faltan.join(', ')}`);
  await c.query('DELETE FROM viaje_contenido WHERE viaje_id = $1', [viajeId]);
  for (const item of contenido) {
    await c.query(
      `INSERT INTO viaje_contenido (viaje_id, cuenta, baldes) VALUES ($1, $2, $3)
       ON CONFLICT (viaje_id, cuenta) DO UPDATE SET baldes = viaje_contenido.baldes + EXCLUDED.baldes`,
      [viajeId, item.cuenta, item.baldes],
    );
  }
  const total = contenido.reduce((a, x) => a + x.baldes, 0);
  await c.query(`UPDATE viaje SET cantidad = $2, unidad = 'balde' WHERE id = $1`, [viajeId, total]);
}

async function aplicar(c: Cliente, op: Operacion, u: UsuarioToken, ahora: number) {
  const sede = u.sede_id as string;
  switch (op.tipo) {
    case 'turno_inicio':
      validarHora(op.inicio, ahora);
      await exigirRecurso(c, op.recurso_id, sede);
      await c.query(
        `INSERT INTO turno (id, sede_id, usuario_id, recurso_id, inicio) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [op.id, sede, u.id, op.recurso_id, op.inicio],
      );
      return;
    case 'turno_fin': {
      validarHora(op.fin, ahora);
      const r = await c.query(
        'UPDATE turno SET fin = $3 WHERE id = $1 AND sede_id = $2 AND ($4 OR usuario_id = $5) AND inicio < $3',
        [op.id, sede, op.fin, u.rol === 'jefe_sede', u.id],
      );
      if (!r.rowCount) throw new Rechazo('Turno no encontrado o fin anterior al inicio.');
      return;
    }
    case 'llamado':
      validarHora(op.creado_en, ahora);
      await exigirPunto(c, op.bloque_id, sede, ['bloque', 'banco']);
      await c.query(
        `INSERT INTO llamado (id, sede_id, bloque_id, producto, cantidad_estimada, creado_por, creado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [op.id, sede, op.bloque_id, op.producto, op.cantidad_estimada, u.id, op.creado_en],
      );
      return;
    case 'llamado_cancelar':
      await c.query(
        `UPDATE llamado SET estado = 'cancelado' WHERE id = $1 AND sede_id = $2 AND estado IN ('pendiente', 'asignado')`,
        [op.id, sede],
      );
      return;
    case 'viaje': {
      validarHora(op.creado_en, ahora);
      await exigirPunto(c, op.origen_id, sede);
      await exigirPunto(c, op.destino_id, sede);
      await exigirRecurso(c, op.recurso_id, sede);
      let transportador = u.id;
      if (u.rol !== 'transportador') {
        if (op.transportador_id === null) throw new Rechazo('Indique el transportador del viaje.');
        const t = await c.query(
          `SELECT 1 FROM usuario WHERE id = $1 AND sede_id = $2 AND rol = 'transportador' AND activo`,
          [op.transportador_id, sede],
        );
        if (!t.rowCount) throw new Rechazo('El transportador no existe o no es de la sede.');
        transportador = op.transportador_id;
      }
      const r = await c.query(
        `INSERT INTO viaje (id, sede_id, transportador_id, turno_id, recurso_id, llamado_id, origen_id, destino_id,
                            producto, cantidad, unidad, creado_en, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (id) DO NOTHING`,
        [
          op.id,
          sede,
          transportador,
          op.turno_id,
          op.recurso_id,
          op.llamado_id,
          op.origen_id,
          op.destino_id,
          op.producto,
          op.cantidad,
          op.unidad,
          op.creado_en,
          u.id,
        ],
      );
      if (!r.rowCount) return; // reenvío de un viaje ya guardado
      if (op.contenido.length) await guardarContenido(c, op.id, op.contenido);
      if (op.llamado_id) {
        await c.query(
          `UPDATE llamado SET estado = 'asignado', asignado_a = $2, asignado_en = $3
           WHERE id = $1 AND sede_id = $4 AND estado = 'pendiente'`,
          [op.llamado_id, transportador, op.creado_en, sede],
        );
      }
      return;
    }
    case 'contenido':
      await exigirViaje(c, op.viaje_id, u, true);
      await guardarContenido(c, op.viaje_id, op.contenido);
      return;
    case 'evento': {
      validarHora(op.ocurrido_en, ahora);
      await exigirViaje(c, op.viaje_id, u, true);
      await c.query(
        `INSERT INTO evento_viaje (id, viaje_id, tipo, ocurrido_en, registrado_por) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [op.id, op.viaje_id, op.evento, op.ocurrido_en, u.id],
      );
      if (op.evento === 'salida_bloque') {
        await c.query(
          `UPDATE llamado SET estado = 'atendido'
           WHERE id = (SELECT llamado_id FROM viaje WHERE id = $1) AND estado IN ('pendiente', 'asignado')`,
          [op.viaje_id],
        );
      }
      return;
    }
    case 'espera_inicio': {
      validarHora(op.inicio, ahora);
      if (op.viaje_id) await exigirViaje(c, op.viaje_id, u, true);
      const causa = await c.query('SELECT 1 FROM causa_espera WHERE codigo = $1', [op.causa]);
      if (!causa.rowCount) throw new Rechazo(`Causa de espera desconocida: ${op.causa}`);
      await c.query(
        `INSERT INTO espera (id, sede_id, usuario_id, viaje_id, causa, inicio) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [op.id, sede, u.id, op.viaje_id, op.causa, op.inicio],
      );
      return;
    }
    case 'espera_fin': {
      validarHora(op.fin, ahora);
      const r = await c.query(
        'UPDATE espera SET fin = $3 WHERE id = $1 AND sede_id = $2 AND inicio <= $3 AND ($4 OR usuario_id = $5)',
        [op.id, sede, op.fin, u.rol === 'jefe_sede', u.id],
      );
      if (!r.rowCount) throw new Rechazo('Espera no encontrada o fin anterior al inicio.');
      return;
    }
    case 'recibo':
      validarHora(op.ocurrido_en, ahora);
      await exigirViaje(c, op.viaje_id, u, false);
      await c.query(
        `INSERT INTO recibo (id, viaje_id, recibido_por, ocurrido_en, cantidad, novedad) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [op.id, op.viaje_id, u.id, op.ocurrido_en, op.cantidad, op.novedad],
      );
      return;
    case 'falla': {
      validarHora(op.inicio, ahora);
      await exigirRecurso(c, op.recurso_id, sede);
      if (op.punto_id !== null) await exigirPunto(c, op.punto_id, sede);
      const tipo = await c.query('SELECT 1 FROM tipo_falla WHERE codigo = $1', [op.tipo_falla]);
      if (!tipo.rowCount) throw new Rechazo(`Tipo de falla desconocido: ${op.tipo_falla}`);
      await c.query(
        `INSERT INTO falla (id, sede_id, recurso_id, punto_id, tipo, descripcion, inicio, reportado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [op.id, sede, op.recurso_id, op.punto_id, op.tipo_falla, op.descripcion, op.inicio, u.id],
      );
      return;
    }
    case 'falla_fin': {
      validarHora(op.fin, ahora);
      const r = await c.query('UPDATE falla SET fin = $3 WHERE id = $1 AND sede_id = $2 AND inicio <= $3', [
        op.id,
        sede,
        op.fin,
      ]);
      if (!r.rowCount) throw new Rechazo('Falla no encontrada o fin anterior al inicio.');
      return;
    }
  }
}

export async function rutasSync(app: FastifyInstance) {
  // Recibe un lote de operaciones capturadas en el teléfono. Cada operación se aplica por separado
  // (punto de guardado): una rechazada no bloquea las demás, y reenviar una ya aplicada no la duplica.
  app.post('/api/sync', { preHandler: app.requiere(), bodyLimit: 512 * 1024 }, async (req, rep) => {
    const lote = LoteSyncSchema.safeParse(req.body);
    if (!lote.success)
      return rep.code(400).send({ error: 'Lote inválido', detalle: lote.error.issues.slice(0, 5) });
    const u = req.user;
    if (!u.sede_id) return rep.code(403).send({ error: 'Los usuarios sin sede no registran operación.' });

    const ahora = Date.now();
    const resultado: ResultadoSync = { aplicadas: [], rechazadas: [], reintentar: [] };
    await enTransaccion(app.db, async (c) => {
      for (const op of lote.data.operaciones) {
        if (!PERMISOS[op.tipo].includes(u.rol)) {
          resultado.rechazadas.push({ id: op.id, motivo: 'Su rol no puede registrar esta operación.' });
          continue;
        }
        await c.query('SAVEPOINT op');
        try {
          await aplicar(c, op, u, ahora);
          await c.query('RELEASE SAVEPOINT op');
          resultado.aplicadas.push(op.id);
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT op');
          if (e instanceof Rechazo) {
            resultado.rechazadas.push({ id: op.id, motivo: e.message });
          } else {
            req.log.error(e, 'Error aplicando operación');
            resultado.reintentar.push(op.id);
          }
        }
      }
    });
    return resultado;
  });
}
