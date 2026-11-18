// Acceso a SQL Server (Azure SQL Database). Una capa delgada sobre `mssql` que permite escribir
// consultas con parámetros posicionales ($1, $2…) y obtener { rows, rowCount }.
import sql from 'mssql';

export interface Resultado<T> {
  rows: T[];
  rowCount: number;
  /** Nombres de las columnas en el orden de la consulta. */
  columnas: string[];
}

export interface Ejecutor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(texto: string, valores?: unknown[]): Promise<Resultado<T>>;
}

export interface Db extends Ejecutor {
  pool: sql.ConnectionPool;
  end(): Promise<void>;
}

export type Cliente = Ejecutor;

const ISO_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Asigna a cada valor el tipo de SQL Server adecuado. Las fechas viajan siempre con zona horaria. */
function vincular(req: sql.Request, valores: unknown[]) {
  valores.forEach((v, i) => {
    const nombre = `p${i + 1}`;
    if (v === null || v === undefined) req.input(nombre, sql.NVarChar, null);
    else if (v instanceof Date) req.input(nombre, sql.DateTimeOffset(3), v);
    else if (typeof v === 'string' && ISO_FECHA.test(v))
      req.input(nombre, sql.DateTimeOffset(3), new Date(v));
    else if (typeof v === 'string') req.input(nombre, sql.NVarChar(sql.MAX), v);
    else if (typeof v === 'boolean') req.input(nombre, sql.Bit, v);
    else if (typeof v === 'number') req.input(nombre, Number.isInteger(v) ? sql.Int : sql.Float, v);
    // Las listas se envían como JSON y se leen con OPENJSON en la consulta.
    else if (Array.isArray(v)) req.input(nombre, sql.NVarChar(sql.MAX), JSON.stringify(v));
    else throw new Error(`Tipo de parámetro no soportado en $${i + 1}`);
  });
}

/** Convierte $1, $2… en @p1, @p2… (sintaxis de parámetros de SQL Server). */
export function traducir(texto: string): string {
  return texto.replace(/\$(\d+)/g, '@p$1');
}

async function ejecutar<T>(req: sql.Request, texto: string, valores: unknown[] = []): Promise<Resultado<T>> {
  vincular(req, valores);
  const r = await req.query(traducir(texto));
  const filas = (r.recordset ?? []) as Record<string, unknown>[];
  // SQL Server devuelve los UNIQUEIDENTIFIER en mayúsculas; el teléfono los genera en minúsculas.
  const columnas = Object.values(r.recordset?.columns ?? {}).sort((a, b) => a.index - b.index);
  const uuids = columnas.filter((c) => (c.type as unknown) === sql.UniqueIdentifier).map((c) => c.name);
  if (uuids.length)
    for (const f of filas)
      for (const n of uuids) if (typeof f[n] === 'string') f[n] = (f[n] as string).toLowerCase();
  return {
    rows: filas as T[],
    rowCount: r.rowsAffected.reduce((a, b) => a + b, 0),
    columnas: columnas.map((c) => c.name),
  };
}

export function crearPool(cadena: string): Db {
  const pool = new sql.ConnectionPool(cadena);
  const listo = pool.connect();
  return {
    pool,
    async query<T>(texto: string, valores?: unknown[]) {
      await listo;
      return ejecutar<T>(pool.request(), texto, valores);
    },
    async end() {
      await listo.catch(() => undefined);
      await pool.close();
    },
  };
}

/** Separa un script en lotes por las líneas GO (como sqlcmd). */
export function lotes(script: string): string[] {
  return script
    .split(/^\s*GO\s*$/im)
    .map((l) => l.trim())
    .filter((l) => l.replace(/--.*$/gm, '').trim());
}

export async function enTransaccion<T>(db: Db, fn: (c: Cliente) => Promise<T>): Promise<T> {
  await db.query('SELECT 1'); // asegura la conexión
  const tx = new sql.Transaction(db.pool);
  await tx.begin();
  const cliente: Cliente = { query: (texto, valores) => ejecutar(new sql.Request(tx), texto, valores) };
  try {
    const r = await fn(cliente);
    await tx.commit();
    return r;
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  }
}
