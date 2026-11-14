// Crea o actualiza un usuario desde la terminal del servidor. Útil para el primer administrador.
// Uso: npm run usuario:crear -w api -- --documento 1000 --nombre "Ana" --rol admin --pin 4821 [--sede OL]
import { parseArgs } from 'node:util';
import bcrypt from 'bcryptjs';
import { ROLES, ROLES_GLOBALES, type Rol } from '@shared/dominio';
import { crearPool } from '../db';

const { values: a } = parseArgs({
  options: {
    documento: { type: 'string' },
    nombre: { type: 'string' },
    rol: { type: 'string' },
    pin: { type: 'string' },
    sede: { type: 'string' },
  },
});
if (!a.documento || !a.nombre || !a.rol || !a.pin)
  throw new Error('Faltan --documento, --nombre, --rol o --pin');
if (!ROLES.includes(a.rol as Rol)) throw new Error(`Rol inválido. Opciones: ${ROLES.join(', ')}`);
if (!/^\d{4,6}$/.test(a.pin)) throw new Error('El PIN debe tener de 4 a 6 dígitos');
if (!a.sede && !ROLES_GLOBALES.includes(a.rol as Rol)) throw new Error('Este rol necesita --sede');

const db = crearPool(process.env.DATABASE_URL ?? '');
try {
  await db.query(
    `INSERT INTO usuario (documento, nombre, rol, sede_id, pin_hash) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (documento) DO UPDATE SET nombre = $2, rol = $3, sede_id = $4, pin_hash = $5, activo = true`,
    [a.documento, a.nombre, a.rol, a.sede ?? null, await bcrypt.hash(a.pin, 10)],
  );
  console.log(`Usuario ${a.documento} listo.`);
} finally {
  await db.end();
}
