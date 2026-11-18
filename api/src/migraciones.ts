import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sql from 'mssql';
import { lotes, type Db } from './db';

/** Ejecuta un script SQL crudo (sin parámetros) en una transacción, lote por lote. */
export async function ejecutarScript(
  db: Db,
  script: string,
  despues?: (tx: sql.Transaction) => Promise<void>,
) {
  await db.query('SELECT 1'); // asegura la conexión
  const tx = new sql.Transaction(db.pool);
  await tx.begin();
  try {
    for (const l of lotes(script)) await new sql.Request(tx).batch(l);
    if (despues) await despues(tx);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  }
}

/** Aplica en orden los .sql de la carpeta que aún no estén registrados. Devuelve los aplicados. */
export async function migrar(db: Db, carpeta: string): Promise<string[]> {
  await db.query(
    `IF OBJECT_ID('migracion', 'U') IS NULL
       CREATE TABLE migracion (nombre NVARCHAR(200) PRIMARY KEY,
                               aplicada_en DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET())`,
  );
  const archivos = (await readdir(carpeta)).filter((f) => f.endsWith('.sql')).sort();
  const aplicadas: string[] = [];
  for (const f of archivos) {
    const script = await readFile(path.join(carpeta, f), 'utf8');
    let aplicada = false;
    try {
      await ejecutarScript(db, '', async (tx) => {
        // Varias instancias de App Service pueden arrancar a la vez: solo una migra.
        await new sql.Request(tx).query(
          "EXEC sp_getapplock @Resource = 'migraciones', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 120000",
        );
        const ya = await new sql.Request(tx)
          .input('n', sql.NVarChar(200), f)
          .query('SELECT 1 AS x FROM migracion WHERE nombre = @n');
        if (ya.recordset.length) return;
        for (const l of lotes(script)) await new sql.Request(tx).batch(l);
        await new sql.Request(tx)
          .input('n', sql.NVarChar(200), f)
          .query('INSERT INTO migracion (nombre) VALUES (@n)');
        aplicada = true;
      });
    } catch (e) {
      throw new Error(`Falló la migración ${f}: ${(e as Error).message}`);
    }
    if (aplicada) aplicadas.push(f);
  }
  return aplicadas;
}
