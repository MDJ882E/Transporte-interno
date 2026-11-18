// Punto de entrada del web service: aplica las migraciones pendientes, publica la API y, si existe, la app.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearApp } from './app';
import { config } from './config';
import { crearPool } from './db';
import { migrar } from './migraciones';

// Misma estructura en el repositorio y en el paquete que se publica en Azure:
// api/dist/servidor.js, web/dist y db/migrations.
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const carpetaWeb = process.env.WEB_DIR ?? path.join(raiz, 'web/dist');
const carpetaDb = process.env.DB_DIR ?? path.join(raiz, 'db');

const db = crearPool(config.databaseUrl);
if (config.migrarAlArrancar) {
  const aplicadas = await migrar(db, path.join(carpetaDb, 'migrations'));
  if (aplicadas.length) console.log(`Migraciones aplicadas: ${aplicadas.join(', ')}`);
}

const app = await crearApp({
  db,
  jwtSecret: config.jwtSecret,
  duracionSesion: config.duracionSesion,
  offsetZona: config.offsetZona,
  origenesPermitidos: config.origenesPermitidos,
  carpetaWeb: existsSync(path.join(carpetaWeb, 'index.html')) ? carpetaWeb : undefined,
  logger: true,
});

const cerrar = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);

await app.listen({ port: config.puerto, host: '0.0.0.0' });
