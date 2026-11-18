import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import estaticos from '@fastify/static';
import type { Rol } from '@shared/dominio';
import type { Db } from './db';
import { rutasSesion } from './rutas/sesion';
import { rutasMaestros } from './rutas/maestros';
import { rutasSync } from './rutas/sync';
import { rutasConsulta } from './rutas/consulta';
import { rutasTablero } from './rutas/tablero';
import { rutasUsuarios } from './rutas/usuarios';
import { rutasLecturas } from './rutas/lecturas';

export interface UsuarioToken {
  id: number;
  nombre: string;
  rol: Rol;
  sede_id: string | null;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: UsuarioToken;
    user: UsuarioToken;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    offsetZona: string;
    /** preHandler: exige sesión y uno de los roles indicados (sin roles = cualquier rol). */
    requiere: (...roles: Rol[]) => (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
  }
}

export interface OpcionesApp {
  db: Db;
  jwtSecret: string;
  duracionSesion?: string;
  offsetZona?: string;
  origenesPermitidos?: string[];
  logger?: boolean;
  /** Carpeta con la app compilada (web/dist). Si se indica, la API también publica la app: un solo web service. */
  carpetaWeb?: string;
}

export async function crearApp(o: OpcionesApp) {
  const app = Fastify({ logger: o.logger ?? false, trustProxy: true });
  app.decorate('db', o.db);
  app.decorate('offsetZona', o.offsetZona ?? '-05:00');

  await app.register(cors, { origin: o.origenesPermitidos?.length ? o.origenesPermitidos : false });
  await app.register(jwt, { secret: o.jwtSecret, sign: { expiresIn: o.duracionSesion ?? '14h' } });
  await app.register(rateLimit, { global: false });

  app.decorate('requiere', (...roles: Rol[]) => async (req: FastifyRequest, rep: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return rep.code(401).send({ error: 'Sesión vencida o inválida. Ingrese de nuevo.' });
    }
    // El usuario puede haber sido desactivado después de iniciar sesión.
    const activo = await o.db.query('SELECT 1 FROM usuario WHERE id = $1 AND activo = 1', [req.user.id]);
    if (!activo.rowCount) return rep.code(401).send({ error: 'Usuario inactivo.' });
    if (roles.length && !roles.includes(req.user.rol)) {
      return rep.code(403).send({ error: 'Su rol no tiene permiso para esta acción.' });
    }
  });

  app.get('/api/salud', async () => {
    await o.db.query('SELECT 1');
    return { ok: true };
  });

  await app.register(rutasSesion);
  await app.register(rutasMaestros);
  await app.register(rutasSync);
  await app.register(rutasConsulta);
  await app.register(rutasTablero);
  await app.register(rutasUsuarios);
  await app.register(rutasLecturas);

  if (o.carpetaWeb) {
    await app.register(estaticos, {
      root: o.carpetaWeb,
      wildcard: false,
      setHeaders(res, ruta) {
        // index.html y el service worker se revisan siempre, así las actualizaciones llegan a los teléfonos;
        // los archivos de assets/ llevan hash en el nombre y pueden guardarse indefinidamente.
        if (/[\\/]assets[\\/]/.test(ruta)) res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
    // Rutas de la app (navegación del lado del cliente): se responde con index.html.
    app.setNotFoundHandler((req, rep) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.url.startsWith('/api/'))
        return rep.code(404).send({ error: 'Ruta no encontrada.' });
      return rep.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }
  return app;
}

/** Sede sobre la que puede consultar el usuario: la suya, o la pedida si su alcance es global. */
export function sedeConsulta(u: UsuarioToken, pedida: string | undefined): string | null {
  if (u.sede_id) return u.sede_id;
  return pedida ?? null;
}

/** Inicio y fin (exclusivo) de un día local, como instantes absolutos. */
export function ventanaDia(fecha: string, offset: string): { desde: Date; hasta: Date } {
  const desde = new Date(`${fecha}T00:00:00${offset}`);
  if (Number.isNaN(desde.getTime())) throw new Error('Fecha inválida');
  return { desde, hasta: new Date(desde.getTime() + 86_400_000) };
}

/** Fecha local de hoy (AAAA-MM-DD) para el desfase indicado. */
export function hoyLocal(offset: string, ahora = new Date()): string {
  const signo = offset.startsWith('-') ? -1 : 1;
  const [hh, mm] = offset.slice(1).split(':').map(Number);
  const local = new Date(ahora.getTime() + signo * ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  return local.toISOString().slice(0, 10);
}
