import type { FastifyInstance } from 'fastify';
import { hoyLocal, sedeConsulta, ventanaDia } from '../app';

export interface ViajeDetalle {
  id: string;
  transportador: string;
  transportador_id: number;
  origen: string;
  origen_id: number;
  destino: string;
  destino_id: number;
  producto: string;
  cantidad: number;
  unidad: string;
  llamado_id: string | null;
  creado_en: string;
  eventos: Record<string, string>;
  recibido: boolean;
}

/** Subconsulta con los eventos de un viaje como JSON ([{tipo, ocurrido_en}]). Requiere el alias v para viaje. */
export const EVENTOS_JSON = `(SELECT e.tipo, e.ocurrido_en FROM evento_viaje e WHERE e.viaje_id = v.id FOR JSON PATH)`;

/** Convierte el JSON de EVENTOS_JSON en { tipo: hora ISO }. */
export function leerEventos(json: string | null): Record<string, string> {
  if (!json) return {};
  const lista = JSON.parse(json) as { tipo: string; ocurrido_en: string }[];
  return Object.fromEntries(lista.map((e) => [e.tipo, new Date(e.ocurrido_en).toISOString()]));
}

/** Viajes de un día con sus eventos. Reutilizado por el tablero y la exportación. */
export async function viajesDelDia(
  app: FastifyInstance,
  sede: string,
  desde: Date,
  hasta: Date,
  transportadorId?: number,
): Promise<ViajeDetalle[]> {
  const r = await app.db.query<Omit<ViajeDetalle, 'eventos'> & { eventos: string | null }>(
    `SELECT v.id, u.nombre AS transportador, v.transportador_id, o.nombre AS origen, v.origen_id,
            d.nombre AS destino, v.destino_id, v.producto, v.cantidad, v.unidad, v.llamado_id, v.creado_en,
            ${EVENTOS_JSON} AS eventos,
            CAST(CASE WHEN EXISTS (SELECT 1 FROM recibo r WHERE r.viaje_id = v.id) THEN 1 ELSE 0 END AS BIT) AS recibido
     FROM viaje v
     JOIN usuario u ON u.id = v.transportador_id
     JOIN punto o ON o.id = v.origen_id
     JOIN punto d ON d.id = v.destino_id
     WHERE v.sede_id = $1 AND v.creado_en >= $2 AND v.creado_en < $3 AND v.anulado = 0
       AND ($4 IS NULL OR v.transportador_id = $4)
     ORDER BY v.creado_en DESC`,
    [sede, desde, hasta, transportadorId ?? null],
  );
  return r.rows.map((v) => ({ ...v, eventos: leerEventos(v.eventos) }));
}

export async function rutasConsulta(app: FastifyInstance) {
  // Cola de llamados abiertos de la sede (pendientes y asignados de las últimas 24 h).
  app.get('/api/llamados', { preHandler: app.requiere() }, async (req, rep) => {
    const sede = sedeConsulta(req.user, (req.query as { sede?: string }).sede);
    if (!sede) return rep.code(400).send({ error: 'Indique la sede.' });
    const r = await app.db.query(
      `SELECT l.id, l.bloque_id, p.nombre AS bloque, l.producto, l.cantidad_estimada, l.estado, l.creado_en,
              l.asignado_a, a.nombre AS asignado_nombre, c.nombre AS creado_por_nombre
       FROM llamado l
       JOIN punto p ON p.id = l.bloque_id
       JOIN usuario c ON c.id = l.creado_por
       LEFT JOIN usuario a ON a.id = l.asignado_a
       WHERE l.sede_id = $1 AND l.estado IN ('pendiente', 'asignado') AND l.creado_en > DATEADD(HOUR, -24, SYSDATETIMEOFFSET())
       ORDER BY l.creado_en`,
      [sede],
    );
    return r.rows;
  });

  // Viajes del día. El transportador ve solo los suyos; los demás roles, toda la sede.
  app.get('/api/viajes', { preHandler: app.requiere() }, async (req, rep) => {
    const q = req.query as { sede?: string; fecha?: string };
    const sede = sedeConsulta(req.user, q.sede);
    if (!sede) return rep.code(400).send({ error: 'Indique la sede.' });
    const { desde, hasta } = ventanaDia(q.fecha ?? hoyLocal(app.offsetZona), app.offsetZona);
    return viajesDelDia(app, sede, desde, hasta, req.user.rol === 'transportador' ? req.user.id : undefined);
  });

  // Fallas abiertas de la sede.
  app.get('/api/fallas', { preHandler: app.requiere() }, async (req, rep) => {
    const sede = sedeConsulta(req.user, (req.query as { sede?: string }).sede);
    if (!sede) return rep.code(400).send({ error: 'Indique la sede.' });
    const r = await app.db.query(
      `SELECT f.id, f.tipo, t.nombre AS tipo_nombre, f.descripcion, f.inicio, r.codigo AS recurso, p.nombre AS punto,
              u.nombre AS reportado_por
       FROM falla f
       JOIN tipo_falla t ON t.codigo = f.tipo
       JOIN usuario u ON u.id = f.reportado_por
       LEFT JOIN recurso r ON r.id = f.recurso_id
       LEFT JOIN punto p ON p.id = f.punto_id
       WHERE f.sede_id = $1 AND f.fin IS NULL
       ORDER BY f.inicio`,
      [sede],
    );
    return r.rows;
  });
}
