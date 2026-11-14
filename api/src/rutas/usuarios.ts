import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ROLES, ROLES_GLOBALES, type Rol } from '@shared/dominio';

/** Roles que un jefe de sede puede crear en su propia sede. */
const ROLES_OPERATIVOS: readonly Rol[] = ['transportador', 'lider_corte', 'recibidor'];

const NuevoUsuario = z.object({
  documento: z.string().trim().min(3).max(20),
  nombre: z.string().trim().min(3).max(80),
  rol: z.enum(ROLES),
  sede_id: z.string().length(2).nullable(),
  pin: z.string().regex(/^\d{4,6}$/),
  codigo_barras: z.string().trim().min(1).max(40).nullable().default(null),
});

const CambioUsuario = z.object({
  activo: z.boolean().optional(),
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .optional(),
  codigo_barras: z.string().trim().min(1).max(40).optional(),
});

export async function rutasUsuarios(app: FastifyInstance) {
  const gestores = app.requiere('jefe_sede', 'admin');

  app.get('/api/usuarios', { preHandler: gestores }, async (req) => {
    const r = await app.db.query(
      `SELECT id, documento, nombre, rol, sede_id, activo, codigo_barras FROM usuario
       WHERE $1::text IS NULL OR sede_id = $1 ORDER BY activo DESC, sede_id, rol, nombre`,
      [req.user.sede_id],
    );
    return r.rows;
  });

  app.post('/api/usuarios', { preHandler: gestores }, async (req, rep) => {
    const d = NuevoUsuario.safeParse(req.body);
    if (!d.success)
      return rep.code(400).send({ error: 'Datos inválidos', detalle: d.error.issues.slice(0, 5) });
    const u = d.data;
    if (
      req.user.rol === 'jefe_sede' &&
      (u.sede_id !== req.user.sede_id || !ROLES_OPERATIVOS.includes(u.rol))
    ) {
      return rep
        .code(403)
        .send({ error: 'Un jefe de sede solo crea transportadores, líderes y recibidores de su sede.' });
    }
    if (!u.sede_id && !ROLES_GLOBALES.includes(u.rol))
      return rep.code(400).send({ error: 'Este rol necesita sede.' });
    const r = await app.db.query(
      `INSERT INTO usuario (documento, nombre, rol, sede_id, pin_hash, codigo_barras) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING RETURNING id`,
      [u.documento, u.nombre, u.rol, u.sede_id, await bcrypt.hash(u.pin, 10), u.codigo_barras],
    );
    if (!r.rowCount)
      return rep.code(409).send({ error: 'Ya existe un usuario con ese documento o código de barras.' });
    return rep.code(201).send({ id: r.rows[0].id });
  });

  // Activar/desactivar o cambiar PIN. El jefe de sede solo gestiona usuarios operativos de su sede.
  app.patch('/api/usuarios/:id', { preHandler: gestores }, async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const d = CambioUsuario.safeParse(req.body);
    if (!Number.isInteger(id) || !d.success) return rep.code(400).send({ error: 'Datos inválidos' });
    const pinHash = d.data.pin ? await bcrypt.hash(d.data.pin, 10) : null;
    const r = await app.db.query(
      `UPDATE usuario SET activo = COALESCE($2, activo), pin_hash = COALESCE($3, pin_hash),
              codigo_barras = COALESCE($6, codigo_barras)
       WHERE id = $1 AND ($4::text IS NULL OR (sede_id = $4 AND rol = ANY($5)))`,
      [
        id,
        d.data.activo ?? null,
        pinHash,
        req.user.rol === 'admin' ? null : req.user.sede_id,
        ROLES_OPERATIVOS,
        d.data.codigo_barras ?? null,
      ],
    );
    if (!r.rowCount) return rep.code(404).send({ error: 'Usuario no encontrado o fuera de su alcance.' });
    return { ok: true };
  });

  // Cuentas o clientes de los baldes (catálogo común a las sedes).
  const Cuenta = z.object({
    codigo: z.string().trim().min(1).max(20),
    nombre: z.string().trim().min(2).max(80),
  });

  app.get('/api/cuentas', { preHandler: gestores }, async () => {
    return (await app.db.query('SELECT codigo, nombre, activo FROM cuenta ORDER BY activo DESC, nombre'))
      .rows;
  });

  app.post('/api/cuentas', { preHandler: gestores }, async (req, rep) => {
    const d = Cuenta.safeParse(req.body);
    if (!d.success) return rep.code(400).send({ error: 'Código y nombre son obligatorios.' });
    await app.db.query(
      `INSERT INTO cuenta (codigo, nombre) VALUES ($1, $2)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true`,
      [d.data.codigo, d.data.nombre],
    );
    return rep.code(201).send({ ok: true });
  });

  app.patch('/api/cuentas/:codigo', { preHandler: gestores }, async (req, rep) => {
    const activo = (req.body as { activo?: unknown })?.activo;
    if (typeof activo !== 'boolean') return rep.code(400).send({ error: 'Indique activo: true o false.' });
    const r = await app.db.query('UPDATE cuenta SET activo = $2 WHERE codigo = $1', [
      (req.params as { codigo: string }).codigo,
      activo,
    ]);
    return r.rowCount ? { ok: true } : rep.code(404).send({ error: 'Cuenta no encontrada.' });
  });
}
