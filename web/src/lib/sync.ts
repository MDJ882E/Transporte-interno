// Envío de la cola local al servidor. Se ejecuta al registrar algo, al recuperar la señal y cada 15 s.
import type { ResultadoSync } from '@shared/dominio';
import {
  contarPendientes,
  guardarRechazo,
  leerSesion,
  marcarIntento,
  pendientes,
  quitarDeCola,
} from './almacen';
import { ErrorApi, post } from './api';

export interface EstadoSync {
  pendientes: number;
  enviando: boolean;
  enLinea: boolean;
  /** Mensaje para el usuario cuando algo falla. */
  aviso: string | null;
  ultimoEnvio: string | null;
}

let estado: EstadoSync = {
  pendientes: 0,
  enviando: false,
  enLinea: typeof navigator === 'undefined' ? true : navigator.onLine,
  aviso: null,
  ultimoEnvio: null,
};
const oyentes = new Set<(e: EstadoSync) => void>();

function publicar(cambio: Partial<EstadoSync>) {
  estado = { ...estado, ...cambio };
  oyentes.forEach((f) => f(estado));
}

export function suscribir(f: (e: EstadoSync) => void): () => void {
  oyentes.add(f);
  f(estado);
  return () => oyentes.delete(f);
}

let enCurso: Promise<void> | null = null;

/** Envía las operaciones pendientes del usuario en sesión. Nunca lanza: informa por el estado. */
export function sincronizar(): Promise<void> {
  enCurso ??= (async () => {
    try {
      const sesion = await leerSesion();
      if (!sesion) return;
      const uid = sesion.usuario.id;
      publicar({ enviando: true });
      for (;;) {
        const lote = await pendientes(uid, 100);
        if (!lote.length) break;
        const r = await post<ResultadoSync>('/api/sync', { operaciones: lote.map((x) => x.op) });
        const porId = new Map(lote.map((x) => [x.op.id, x]));
        const terminadas: number[] = [];
        for (const id of r.aplicadas) terminadas.push(porId.get(id)!.seq!);
        for (const rz of r.rechazadas) {
          const item = porId.get(rz.id)!;
          await guardarRechazo({
            id: rz.id,
            motivo: rz.motivo,
            op: item.op,
            fecha: new Date().toISOString(),
          });
          terminadas.push(item.seq!);
        }
        for (const id of r.reintentar) await marcarIntento(porId.get(id)!);
        await quitarDeCola(terminadas);
        publicar({
          aviso: r.rechazadas.length
            ? `${r.rechazadas.length} registro(s) rechazado(s): ${r.rechazadas[0]!.motivo}`
            : null,
          ultimoEnvio: new Date().toISOString(),
        });
        if (r.reintentar.length) break; // error temporal del servidor: se reintenta en el próximo ciclo
      }
      publicar({ enLinea: true });
    } catch (e) {
      const sinRed = e instanceof ErrorApi && e.estado === 0;
      publicar({
        enLinea: !sinRed,
        aviso: sinRed
          ? null
          : e instanceof ErrorApi && e.estado === 401
            ? 'Sesión vencida: ingrese de nuevo para enviar.'
            : (e as Error).message,
      });
    } finally {
      const sesion = await leerSesion();
      publicar({ enviando: false, pendientes: sesion ? await contarPendientes(sesion.usuario.id) : 0 });
      enCurso = null;
    }
  })();
  return enCurso;
}

let temporizador: ReturnType<typeof setInterval> | undefined;

export function iniciarSincronizacion() {
  if (temporizador) return;
  window.addEventListener('online', () => void sincronizar());
  window.addEventListener('offline', () => publicar({ enLinea: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sincronizar();
  });
  temporizador = setInterval(() => void sincronizar(), 15_000);
  void sincronizar();
}
