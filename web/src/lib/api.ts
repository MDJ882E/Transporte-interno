// Cliente HTTP de la API. Lanza ErrorApi con el mensaje del servidor para mostrarlo tal cual.
import { leerSesion } from './almacen';

export class ErrorApi extends Error {
  constructor(
    public estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export async function api<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const sesion = await leerSesion();
  const headers = new Headers(opciones.headers);
  if (sesion) headers.set('authorization', `Bearer ${sesion.token}`);
  if (opciones.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let r: Response;
  try {
    r = await fetch(ruta, { ...opciones, headers });
  } catch {
    throw new ErrorApi(0, 'Sin conexión con el servidor.');
  }
  if (!r.ok) {
    const cuerpo = (await r.json().catch(() => ({}))) as { error?: string };
    throw new ErrorApi(r.status, cuerpo.error ?? `Error ${r.status}`);
  }
  const tipo = r.headers.get('content-type') ?? '';
  return (tipo.includes('application/json') ? r.json() : r.blob()) as Promise<T>;
}

export const post = <T>(ruta: string, cuerpo: unknown) =>
  api<T>(ruta, { method: 'POST', body: JSON.stringify(cuerpo) });
