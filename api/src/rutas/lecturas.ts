import type { FastifyInstance } from 'fastify';
import { LoteLecturasSchema, type ResultadoImportacion } from '@shared/dominio';
import { sedeConsulta } from '../app';
import { enTransaccion } from '../db';
import { emparejar, VENTANA_EMPAREJAR_MIN } from '../emparejar';

export async function rutasLecturas(app: FastifyInstance) {
  // Importa lecturas del sistema de código de barras de poscosecha (archivo exportado, ya interpretado en la app)
  // y las empareja con los viajes despachados. Reimportar el mismo archivo no duplica lecturas.
  app.post(
    '/api/lecturas',
    { preHandler: app.requiere('recibidor', 'jefe_sede', 'admin'), bodyLimit: 4 * 1024 * 1024 },
    async (req, rep) => {
      const lote = LoteLecturasSchema.safeParse(req.body);
      if (!lote.success)
        return rep.code(400).send({ error: 'Lecturas inválidas', detalle: lote.error.issues.slice(0, 5) });
      const sede = sedeConsulta(req.user, lote.data.sede_id);
      if (!sede) return rep.code(400).send({ error: 'Indique la sede.' });

      return enTransaccion(app.db, async (c): Promise<ResultadoImportacion> => {
        const codigos = [...new Set(lote.data.lecturas.map((l) => l.codigo_transportador))];
        const mapa = new Map(
          (
            await c.query<{ codigo_barras: string; id: number }>(
              `SELECT codigo_barras, id FROM usuario WHERE sede_id = $1 AND codigo_barras = ANY($2)`,
              [sede, codigos],
            )
          ).rows.map((r) => [r.codigo_barras, r.id]),
        );

        let nuevas = 0;
        for (const l of lote.data.lecturas) {
          const r = await c.query(
            `INSERT INTO lectura_poscosecha (sede_id, codigo_transportador, transportador_id, baldes, ocurrido_en,
                                             novedad, archivo, importado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             -- Si el código no tenía transportador y ahora sí, se completa al reimportar.
             ON CONFLICT (sede_id, codigo_transportador, ocurrido_en) DO UPDATE
               SET transportador_id = EXCLUDED.transportador_id
               WHERE lectura_poscosecha.transportador_id IS NULL AND EXCLUDED.transportador_id IS NOT NULL
             RETURNING (xmax = 0) AS insertada`,
            [
              sede,
              l.codigo_transportador,
              mapa.get(l.codigo_transportador) ?? null,
              l.baldes,
              l.ocurrido_en,
              l.novedad,
              lote.data.archivo,
              req.user.id,
            ],
          );
          if (r.rows[0]?.insertada) nuevas++;
        }

        // Emparejar todas las lecturas pendientes del rango del archivo (también las de importaciones previas).
        const tiempos = lote.data.lecturas.map((l) => Date.parse(l.ocurrido_en));
        const desde = new Date(Math.min(...tiempos) - 86_400_000);
        const hasta = new Date(Math.max(...tiempos) + 60_000);
        const pendientes = await c.query<{
          id: number;
          transportador_id: number;
          ocurrido_en: Date;
          baldes: number;
          novedad: string | null;
        }>(
          `SELECT id, transportador_id, ocurrido_en, baldes, novedad FROM lectura_poscosecha
           WHERE sede_id = $1 AND viaje_id IS NULL AND transportador_id IS NOT NULL
             AND ocurrido_en BETWEEN $2 AND $3`,
          [sede, desde, hasta],
        );
        const abiertos = await c.query<{ id: string; transportador_id: number; salida_bloque: Date }>(
          `SELECT v.id, v.transportador_id, s.ocurrido_en AS salida_bloque
           FROM viaje v
           JOIN evento_viaje s ON s.viaje_id = v.id AND s.tipo = 'salida_bloque'
           WHERE v.sede_id = $1 AND NOT v.anulado
             AND s.ocurrido_en BETWEEN $2::timestamptz - make_interval(mins => $4) AND $3
             AND NOT EXISTS (SELECT 1 FROM evento_viaje d WHERE d.viaje_id = v.id AND d.tipo = 'llegada_destino')
             AND NOT EXISTS (SELECT 1 FROM lectura_poscosecha l WHERE l.viaje_id = v.id)`,
          [sede, desde, hasta, VENTANA_EMPAREJAR_MIN],
        );
        const pares = emparejar(
          abiertos.rows,
          pendientes.rows.map((l) => ({
            clave: l.id,
            transportador_id: l.transportador_id,
            ocurrido_en: l.ocurrido_en,
          })),
        );
        const porId = new Map(pendientes.rows.map((l) => [l.id, l]));
        for (const [lecturaId, viajeId] of pares) {
          const l = porId.get(lecturaId as number)!;
          await c.query('UPDATE lectura_poscosecha SET viaje_id = $2 WHERE id = $1', [lecturaId, viajeId]);
          await c.query(
            `INSERT INTO evento_viaje (id, viaje_id, tipo, ocurrido_en, registrado_por, origen)
             VALUES (gen_random_uuid(), $1, 'llegada_destino', $2, $3, 'lectura_poscosecha') ON CONFLICT DO NOTHING`,
            [viajeId, l.ocurrido_en, req.user.id],
          );
          await c.query(
            `INSERT INTO recibo (id, viaje_id, recibido_por, ocurrido_en, cantidad, novedad)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [viajeId, req.user.id, l.ocurrido_en, l.baldes, l.novedad],
          );
        }

        return {
          leidas: lote.data.lecturas.length,
          nuevas,
          emparejadas: pares.size,
          sin_transportador: codigos.filter((k) => !mapa.has(k)),
          sin_viaje: pendientes.rows.length - pares.size,
        };
      });
    },
  );
}
