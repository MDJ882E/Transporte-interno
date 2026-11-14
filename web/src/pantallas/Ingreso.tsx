import { useState, type FormEvent } from 'react';
import type { Sesion } from '@shared/dominio';
import { ErrorApi, post } from '../lib/api';

export function Ingreso(props: { alIngresar: (s: Sesion) => void }) {
  const [documento, setDocumento] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function ingresar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      props.alIngresar(await post<Sesion>('/api/sesion', { documento: documento.trim(), pin }));
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo ingresar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="contenedor pila" style={{ paddingTop: 48 }}>
      <div className="pila" style={{ textAlign: 'center' }}>
        <img src="/icono.svg" alt="" width={72} height={72} style={{ margin: '0 auto' }} />
        <h1>Transporte interno</h1>
        <p className="suave">Ingrese con su documento y su PIN.</p>
      </div>
      <form className="pila tarjeta" onSubmit={ingresar}>
        <label>
          Documento
          <input
            inputMode="numeric"
            autoComplete="username"
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
            required
          />
        </label>
        <label>
          PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            pattern="\d{4,6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            required
          />
        </label>
        {error && <div className="aviso error">{error}</div>}
        <button className="boton primario bloque" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
      <p className="suave pequeno" style={{ textAlign: 'center' }}>
        Para ingresar se necesita conexión. Después la app funciona sin señal.
      </p>
    </main>
  );
}
