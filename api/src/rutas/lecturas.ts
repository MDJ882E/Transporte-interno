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
              `SELECT codigo_barras, id FROM usuario
               WHERE sede_id = $1 AND codigo_barras IN (SELECT v FROM OPENJSON($2) WITH (v NVARCHAR(40) '$'))`,
              [sede, codigos],
            )
          ).rows.map((r) => [r.codigo_barras, r.id]),
        );

        // Se envían todas las lecturas en un solo parámetro JSON: una consulta en vez de miles.
        // Una misma lectura repetida en el archivo se toma una vez.
        const unicas = new Map(
          lote.data.lecturas.map((l) => [
            `${l.codigo_transportador}|${Date.parse(l.ocurrido_en)}`,
            {
              codigo: l.codigo_transportador,
              transportador_id: mapa.get(l.codigo_transportador) ?? null,
              baldes: l.baldes,
              ocurrido_en: new Date(l.ocurrido_en).toISOString(),
              novedad: l.novedad,
            },
          ]),
        );
        const json = JSON.stringify([...unicas.values()]);
        const LECTURAS = `OPENJSON($2) WITH (codigo NVARCHAR(40) '$.codigo', transportador_id INT '$.transportador_id',
                            baldes INT '$.baldes', ocurrido_en DATETIMEOFFSET(3) '$.ocurrido_en',
                            novedad NVARCHAR(500) '$.novedad')`;
        // Si el código no tenía transportador y ahora sí, se completa al reimportar.
        await c.query(
          `UPDATE l SET transportador_id = j.transportador_id
           FROM lectura_poscosecha l
           JOIN ${LECTURAS} j ON l.codigo_transportador = j.codigo AND l.ocurrido_en = j.ocurrido_en
           WHERE l.sede_id = $1 AND l.transportador_id IS NULL AND j.transportador_id IS NOT NULL`,
          [sede, json],
        );
        const insertadas = await c.query(
          `INSERT INTO lectura_poscosecha (sede_id, codigo_transportador, transportador_id, baldes, ocurrido_en,
                                           novedad, archivo, importado_por)
           SELECT $1, j.codigo, j.transportador_id, j.baldes, j.ocurrido_en, j.novedad, $3, $4
           FROM ${LECTURAS} j
           WHERE NOT EXISTS (SELECT 1 FROM lectura_poscosecha l
                             WHERE l.sede_id = $1 AND l.codigo_transportador = j.codigo AND l.ocurrido_en = j.ocurrido_en)`,
          [sede, json, lote.data.archivo, req.user.id],
        );
        const nuevas = insertadas.rowCount;

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
           WHERE v.sede_id = $1 AND v.anulado = 0
             AND s.ocurrido_en BETWEEN DATEADD(MINUTE, -$4, $2) AND $3
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
            `IF NOT EXISTS (SELECT 1 FROM evento_viaje WHERE viaje_id = $1 AND tipo = 'llegada_destino')
               INSERT INTO evento_viaje (id, viaje_id, tipo, ocurrido_en, registrado_por, origen)
               VALUES (NEWID(), $1, 'llegada_destino', $2, $3, 'lectura_poscosecha')`,
            [viajeId, l.ocurrido_en, req.user.id],
          );
          await c.query(
            `IF NOT EXISTS (SELECT 1 FROM recibo WHERE viaje_id = $1)
               INSERT INTO recibo (id, viaje_id, recibido_por, ocurrido_en, cantidad, novedad)
               VALUES (NEWID(), $1, $2, $3, $4, $5)`,
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
