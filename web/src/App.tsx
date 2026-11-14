import { useEffect, useState } from 'react';
import { ROL_NOMBRE, type Maestros, type Rol, type Sesion } from '@shared/dominio';
import { borrar, contarPendientes, guardar, leerMaestros, leerSesion } from './lib/almacen';
import { api, ErrorApi } from './lib/api';
import { iniciarSincronizacion, sincronizar } from './lib/sync';
import { AvisoSync, EstadoEnvio } from './ui';
import { Ingreso } from './pantallas/Ingreso';
import { Despacho } from './pantallas/Despacho';
import { Transportador } from './pantallas/Transportador';
import { Tablero } from './pantallas/Tablero';
import { ImportarLecturas } from './pantallas/ImportarLecturas';
import { Administracion } from './pantallas/Administracion';

type Vista = 'despacho' | 'turno' | 'tablero' | 'lecturas' | 'administracion';

const VISTAS: Record<Rol, Vista[]> = {
  transportador: ['turno'],
  lider_corte: ['despacho', 'tablero'],
  recibidor: ['lecturas'],
  jefe_sede: ['tablero', 'despacho', 'lecturas', 'administracion'],
  gerencia: ['tablero'],
  admin: ['tablero', 'lecturas', 'administracion'],
};

const NOMBRE_VISTA: Record<Vista, string> = {
  despacho: 'Despacho',
  turno: 'Mi turno',
  tablero: 'Tablero',
  lecturas: 'Lecturas poscosecha',
  administracion: 'Usuarios',
};

export function App() {
  const [cargando, setCargando] = useState(true);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [maestros, setMaestros] = useState<Maestros | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refrescarMaestros() {
    try {
      const m = await api<Maestros>('/api/maestros');
      await guardar('maestros', m);
      setMaestros(m);
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 401) return setSesion(null);
      const guardados = await leerMaestros();
      if (guardados) setMaestros(guardados);
      else setError('No hay datos guardados en este teléfono y no hay conexión. Conéctese para continuar.');
    }
  }

  useEffect(() => {
    void (async () => {
      const s = await leerSesion();
      setSesion(s ?? null);
      if (s) {
        setMaestros((await leerMaestros()) ?? null);
        await refrescarMaestros();
        iniciarSincronizacion();
      }
      setCargando(false);
    })();
  }, []);

  useEffect(() => {
    if (sesion)
      setVista((v) => (v && VISTAS[sesion.usuario.rol].includes(v) ? v : VISTAS[sesion.usuario.rol][0]!));
  }, [sesion]);

  async function alIngresar(s: Sesion) {
    await guardar('sesion', s);
    setSesion(s);
    await refrescarMaestros();
    iniciarSincronizacion();
    void sincronizar();
  }

  async function salir() {
    if (!sesion) return;
    await sincronizar();
    const n = await contarPendientes(sesion.usuario.id);
    if (
      n &&
      !confirm(
        `Hay ${n} registros sin enviar. Se enviarán cuando vuelva a ingresar con su usuario. ¿Salir de todos modos?`,
      )
    ) {
      return;
    }
    await borrar('sesion');
    setSesion(null);
    setVista(null);
  }

  if (cargando) return null;
  if (!sesion) return <Ingreso alIngresar={alIngresar} />;

  const vistas = VISTAS[sesion.usuario.rol];
  return (
    <>
      <header className="barra">
        <div className="fila entre">
          <div>
            <strong>{sesion.usuario.nombre}</strong>
            <div className="pequeno" style={{ opacity: 0.85 }}>
              {ROL_NOMBRE[sesion.usuario.rol]}
              {sesion.usuario.sede_id
                ? ` · ${maestros?.sedes.find((x) => x.id === sesion.usuario.sede_id)?.nombre ?? sesion.usuario.sede_id}`
                : ''}
            </div>
          </div>
          <div className="fila">
            <EstadoEnvio />
            <button onClick={salir}>Salir</button>
          </div>
        </div>
      </header>
      {vistas.length > 1 && (
        <nav className="contenedor ancho" style={{ paddingBottom: 0 }}>
          <div className="pestanas" role="tablist">
            {vistas.map((v) => (
              <button key={v} role="tab" aria-selected={vista === v} onClick={() => setVista(v)}>
                {NOMBRE_VISTA[v]}
              </button>
            ))}
          </div>
        </nav>
      )}
      <div className="contenedor ancho" style={{ paddingBottom: 0 }}>
        <AvisoSync />
        {error && <div className="aviso error">{error}</div>}
      </div>
      {maestros && vista === 'despacho' && <Despacho sesion={sesion} maestros={maestros} />}
      {maestros && vista === 'turno' && <Transportador sesion={sesion} maestros={maestros} />}
      {maestros && vista === 'tablero' && <Tablero sesion={sesion} maestros={maestros} />}
      {maestros && vista === 'lecturas' && <ImportarLecturas sesion={sesion} maestros={maestros} />}
      {maestros && vista === 'administracion' && <Administracion sesion={sesion} maestros={maestros} />}
    </>
  );
}
