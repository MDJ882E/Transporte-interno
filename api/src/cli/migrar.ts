// Aplica las migraciones pendientes. Con --demo carga además datos ficticios para desarrollo.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearPool } from '../db';
import { ejecutarScript, migrar } from '../migraciones';

const raiz = process.env.DB_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db');
const db = crearPool(process.env.DATABASE_URL ?? '');
try {
  const aplicadas = await migrar(db, path.join(raiz, 'migrations'));
  console.log(aplicadas.length ? `Migraciones aplicadas: ${aplicadas.join(', ')}` : 'Base al día.');
  if (process.argv.includes('--demo')) {
    if (process.env.NODE_ENV === 'production')
      throw new Error('No se cargan datos de demostración en producción.');
    await ejecutarScript(db, await readFile(path.join(raiz, 'demo/demo.sql'), 'utf8'));
    console.log('Datos de demostración cargados (PIN de todos los usuarios: 1234).');
  }
} finally {
  await db.end();
}
