import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './db';

/** Aplica en orden los .sql de la carpeta que aún no estén registrados. Devuelve los aplicados. */
export async function migrar(db: Db, carpeta: string): Promise<string[]> {
  await db.query(
    'CREATE TABLE IF NOT EXISTS migracion (nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())',
  );
  const hechas = new Set(
    (await db.query<{ nombre: string }>('SELECT nombre FROM migracion')).rows.map((r) => r.nombre),
  );
  const archivos = (await readdir(carpeta)).filter((f) => f.endsWith('.sql')).sort();
  const aplicadas: string[] = [];
  for (const f of archivos) {
    if (hechas.has(f)) continue;
    const sql = await readFile(path.join(carpeta, f), 'utf8');
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO migracion (nombre) VALUES ($1)', [f]);
      await c.query('COMMIT');
      aplicadas.push(f);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`Falló la migración ${f}: ${(e as Error).message}`);
    } finally {
      c.release();
    }
  }
  return aplicadas;
}
