import type { FastifyInstance } from 'fastify';
import type { Maestros } from '@shared/dominio';

export async function rutasMaestros(app: FastifyInstance) {
  // Datos de referencia que la app guarda en el teléfono para trabajar sin señal.
  app.get('/api/maestros', { preHandler: app.requiere() }, async (req): Promise<Maestros> => {
    const sede = req.user.sede_id; // null = todas las sedes
    const filtro = 'WHERE ($1::text IS NULL OR sede_id = $1) AND activo';
    const [sedes, puntos, recursos, causas, fallas, sugerido, cuentas, transportadores] = await Promise.all([
      app.db.query('SELECT id, nombre, medio FROM sede WHERE ($1::text IS NULL OR id = $1) ORDER BY id', [
        sede,
      ]),
      app.db.query(
        `SELECT id, sede_id, codigo, nombre, tipo FROM punto ${filtro}
         ORDER BY sede_id, tipo, length(codigo), codigo`,
        [sede],
      ),
      app.db.query(`SELECT id, sede_id, codigo, tipo FROM recurso ${filtro} ORDER BY sede_id, codigo`, [
        sede,
      ]),
      app.db.query('SELECT codigo, nombre FROM causa_espera ORDER BY orden'),
      app.db.query('SELECT codigo, nombre, medio FROM tipo_falla ORDER BY orden'),
      // Para cada bloque, la poscosecha con menor ciclo estándar (o menor distancia si no hay ciclo).
      app.db.query<{ bloque: number; destino: number }>(
        `SELECT DISTINCT ON (o.id) o.id AS bloque, d.id AS destino
         FROM distancia x
         JOIN punto o ON o.id = x.origen_id AND o.tipo = 'bloque'
         JOIN punto d ON d.id = x.destino_id AND d.tipo = 'poscosecha' AND d.activo
         WHERE ($1::text IS NULL OR o.sede_id = $1)
         ORDER BY o.id, x.ciclo_estandar_min NULLS LAST, x.metros`,
        [sede],
      ),
      app.db.query('SELECT codigo, nombre FROM cuenta WHERE activo ORDER BY nombre'),
      app.db.query(
        `SELECT id, nombre, sede_id FROM usuario
         WHERE rol = 'transportador' AND activo AND ($1::text IS NULL OR sede_id = $1) ORDER BY nombre`,
        [sede],
      ),
    ]);
    return {
      sedes: sedes.rows,
      puntos: puntos.rows,
      recursos: recursos.rows,
      causas_espera: causas.rows,
      tipos_falla: fallas.rows,
      cuentas: cuentas.rows,
      transportadores: transportadores.rows,
      destino_sugerido: Object.fromEntries(sugerido.rows.map((r) => [r.bloque, r.destino])),
    };
  });
}
