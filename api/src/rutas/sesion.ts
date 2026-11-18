import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Sesion } from '@shared/dominio';
import type { UsuarioToken } from '../app';

const Ingreso = z.object({ documento: z.string().trim().min(1).max(20), pin: z.string().regex(/^\d{4,6}$/) });

export async function rutasSesion(app: FastifyInstance) {
  app.post(
    '/api/sesion',
    // Un PIN de 4 dígitos es débil: se limita el número de intentos por dirección IP.
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req, rep) => {
      const datos = Ingreso.safeParse(req.body);
      if (!datos.success) return rep.code(400).send({ error: 'Documento o PIN con formato inválido.' });
      const r = await app.db.query<UsuarioToken & { pin_hash: string }>(
        'SELECT id, nombre, rol, sede_id, pin_hash FROM usuario WHERE documento = $1 AND activo = 1',
        [datos.data.documento],
      );
      const u = r.rows[0];
      if (!u || !(await bcrypt.compare(datos.data.pin, u.pin_hash))) {
        return rep.code(401).send({ error: 'Documento o PIN incorrecto.' });
      }
      const usuario: UsuarioToken = { id: u.id, nombre: u.nombre, rol: u.rol, sede_id: u.sede_id };
      const respuesta: Sesion = { token: app.jwt.sign(usuario), usuario };
      return respuesta;
    },
  );
}
