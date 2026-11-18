import { useEffect, useState, type ReactNode } from 'react';
import { suscribir, type EstadoSync } from './lib/sync';

export function useEstadoSync(): EstadoSync | null {
  const [e, setE] = useState<EstadoSync | null>(null);
  useEffect(() => suscribir(setE), []);
  return e;
}

/** Re-renderiza cada `ms` para mostrar tiempos transcurridos. */
export function useReloj(ms = 30_000): number {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}

export function hora(iso: string | Date | undefined | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export function haceMin(iso: string, ahora = Date.now()): string {
  const m = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60_000));
  return m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`;
}

export function EstadoEnvio() {
  const e = useEstadoSync();
  if (!e) return null;
  const texto = !e.enLinea
    ? `Sin señal · ${e.pendientes} por enviar`
    : e.pendientes
      ? `${e.pendientes} por enviar`
      : 'Todo enviado';
  return (
    <span
      className={`estado-sync ${!e.enLinea || e.pendientes ? 'alerta' : ''}`}
      role="status"
      aria-live="polite"
    >
      {texto}
    </span>
  );
}

export function AvisoSync() {
  const e = useEstadoSync();
  return e?.aviso ? <div className="aviso error">{e.aviso}</div> : null;
}

export function Hoja(props: { titulo: string; children: ReactNode; alCerrar: () => void }) {
  useEffect(() => {
    const f = (ev: KeyboardEvent) => ev.key === 'Escape' && props.alCerrar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [props]);
  return (
    <div className="velo" onClick={props.alCerrar}>
      <div
        className="hoja pila"
        role="dialog"
        aria-modal="true"
        aria-label={props.titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fila entre">
          <h2>{props.titulo}</h2>
          <button className="enlace" onClick={props.alCerrar}>
            Cancelar
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function Contador(props: {
  valor: number;
  alCambiar: (n: number) => void;
  min?: number;
  etiqueta: string;
}) {
  const min = props.min ?? 0;
  return (
    <div className="contador" role="group" aria-label={props.etiqueta}>
      <button
        type="button"
        aria-label="Menos"
        onClick={() => props.alCambiar(Math.max(min, props.valor - 1))}
      >
        −
      </button>
      <output>{props.valor}</output>
      <button type="button" aria-label="Más" onClick={() => props.alCambiar(props.valor + 1)}>
        +
      </button>
    </div>
  );
}

export function Opciones<T extends string | number>(props: {
  opciones: { valor: T; texto: string }[];
  elegida: T | null;
  alElegir: (v: T) => void;
}) {
  return (
    <div className="cuadricula">
      {props.opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          className="opcion"
          aria-pressed={props.elegida === o.valor}
          onClick={() => props.alElegir(o.valor)}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}
