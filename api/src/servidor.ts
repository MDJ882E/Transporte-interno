import { crearApp } from './app';
import { config } from './config';
import { crearPool } from './db';

const db = crearPool(config.databaseUrl);
const app = await crearApp({
  db,
  jwtSecret: config.jwtSecret,
  duracionSesion: config.duracionSesion,
  offsetZona: config.offsetZona,
  origenesPermitidos: config.origenesPermitidos,
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
