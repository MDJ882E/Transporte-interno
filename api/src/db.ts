import pg from 'pg';

// numeric de PostgreSQL llega como texto; para este dominio (minutos, metros) un número JS es suficiente.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export type Db = pg.Pool;
export type Cliente = pg.PoolClient;

export function crearPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export async function enTransaccion<T>(db: Db, fn: (c: Cliente) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
