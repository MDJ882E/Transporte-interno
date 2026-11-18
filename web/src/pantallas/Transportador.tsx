// Pantalla del transportador, para cuando lleva teléfono. Muestra solo la siguiente acción posible.
// En el piloto con anotador en el bloque no es necesaria, pero queda lista para la siguiente fase.
import { useCallback, useEffect, useState } from 'react';
import {
  EVENTO_ACCION,
  siguienteEvento,
  type Maestros,
  type OperacionEntrada,
  type Sesion,
  type TipoEvento,
} from '@shared/dominio';
import { guardar, leer } from '../lib/almacen';
import { api } from '../lib/api';
import { ahoraIso, nuevoId, registrar } from '../lib/registro';
import { Hoja, Opciones, haceMin, hora, useReloj } from '../ui';
import { ReportarFalla } from './ReportarFalla';

interface Llamado {
  id: string;
  bloque_id: number;
  bloque: string;
  estado: string;
  creado_en: string;
}

interface EstadoTransportador {
  turno: { id: string; inicio: string; recurso_id: number | null } | null;
  viaje: { id: string; origen: string; destino: string; eventos: Partial<Record<TipoEvento, string>> } | null;
  espera: { id: string; causa: string; inicio: string } | null;
}

const VACIO: EstadoTransportador = { turno: null, viaje: null, espera: null };

export function Transportador(props: { sesion: Sesion; maestros: Maestros }) {
  const sede = props.sesion.usuario.sede_id!;
  const clave = `transportador:${props.sesion.usuario.id}`;
  const [estado, setEstado] = useState<EstadoTransportador | null>(null);
  const [llamados, setLlamados] = useState<Llamado[]>([]);
  const [hoja, setHoja] = useState<'turno' | 'bloque' | 'espera' | 'falla' | null>(null);
  const ahora = useReloj(15_000);

  useEffect(() => {
    void leer<EstadoTransportador>(clave).then((e) => setEstado(e ?? VACIO));
  }, [clave]);

  const cargarLlamados = useCallback(async () => {
    try {
      setLlamados(await api<Llamado[]>('/api/llamados'));
    } catch {
      /* sin señal: se conserva la última lista */
    }
  }, []);
  useEffect(() => {
    void cargarLlamados();
    const i = setInterval(() => void cargarLlamados(), 15_000);
    return () => clearInterval(i);
  }, [cargarLlamados]);

  if (!estado) return null;
  const nombre = (id: number) => props.maestros.puntos.find((p) => p.id === id)?.nombre ?? '';

  async function cambiar(nuevo: EstadoTransportador, ...ops: OperacionEntrada[]) {
    setEstado(nuevo);
    await guardar(clave, nuevo);
    await registrar(...ops);
  }

  function iniciarViaje(bloqueId: number, llamadoId: string | null) {
    const destino = props.maestros.destino_sugerido[bloqueId];
    if (!destino || !estado) return;
    const id = nuevoId();
    void cambiar(
      { ...estado, viaje: { id, origen: nombre(bloqueId), destino: nombre(destino), eventos: {} } },
      {
        tipo: 'viaje',
        id,
        turno_id: estado.turno?.id ?? null,
        recurso_id: estado.turno?.recurso_id ?? null,
        llamado_id: llamadoId,
        origen_id: bloqueId,
        destino_id: destino,
        producto: 'flor',
        cantidad: 1,
        unidad: 'garrucha',
        creado_en: ahoraIso(),
      },
    );
    setHoja(null);
  }

  function marcarEvento(evento: TipoEvento) {
    if (!estado?.viaje) return;
    const t = ahoraIso();
    const eventos = { ...estado.viaje.eventos, [evento]: t };
    const cerrado = siguienteEvento(Object.keys(eventos) as TipoEvento[]) === null;
    void cambiar(
      { ...estado, viaje: cerrado ? null : { ...estado.viaje, eventos } },
      { tipo: 'evento', id: nuevoId(), viaje_id: estado.viaje.id, evento, ocurrido_en: t },
    );
    if (cerrado) void cargarLlamados();
  }

  // Sin turno
  if (!estado.turno) {
    return (
      <main className="contenedor pila">
        <h1>Hola, {props.sesion.usuario.nombre.split(' ')[0]}</h1>
        <button className="boton primario gigante" onClick={() => setHoja('turno')}>
          Iniciar turno
        </button>
        {hoja === 'turno' && (
          <ElegirRecurso
            maestros={props.maestros}
            sede={sede}
            alCerrar={() => setHoja(null)}
            alElegir={(recurso_id) => {
              const turno = { id: nuevoId(), inicio: ahoraIso(), recurso_id };
              void cambiar({ ...estado, turno }, { tipo: 'turno_inicio', ...turno });
              setHoja(null);
            }}
          />
        )}
      </main>
    );
  }

  const siguiente = estado.viaje ? siguienteEvento(Object.keys(estado.viaje.eventos) as TipoEvento[]) : null;
  const pendientes = llamados.filter((l) => l.estado === 'pendiente');

  return (
    <main className="contenedor pila">
      {estado.espera && (
        <div className="tarjeta espera pila">
          <strong>
            En espera: {props.maestros.causas_espera.find((c) => c.codigo === estado.espera!.causa)?.nombre} ·{' '}
            {haceMin(estado.espera.inicio, ahora)}
          </strong>
          <button
            className="boton primario bloque"
            onClick={() =>
              void cambiar(
                { ...estado, espera: null },
                { tipo: 'espera_fin', id: estado.espera!.id, fin: ahoraIso() },
              )
            }
          >
            Terminó la espera
          </button>
        </div>
      )}

      {estado.viaje && siguiente ? (
        <section className="tarjeta activa pila">
          <h2>
            {estado.viaje.origen} → {estado.viaje.destino}
          </h2>
          <div className="linea-eventos">
            {(Object.entries(estado.viaje.eventos) as [TipoEvento, string][]).map(([e, t]) => (
              <span key={e}>
                {EVENTO_ACCION[e]} {hora(t)}
              </span>
            ))}
          </div>
          <button className="boton primario gigante" onClick={() => marcarEvento(siguiente)}>
            {EVENTO_ACCION[siguiente]}
          </button>
        </section>
      ) : (
        <section className="pila">
          <h2>Llamados ({pendientes.length})</h2>
          {pendientes.map((l) => (
            <button
              key={l.id}
              className="boton primario gigante"
              onClick={() => iniciarViaje(l.bloque_id, l.id)}
            >
              {l.bloque} · {haceMin(l.creado_en, ahora)}
            </button>
          ))}
          {!pendientes.length && <p className="suave">No hay garruchas listas. Espere el llamado.</p>}
          <button className="boton bloque" onClick={() => setHoja('bloque')}>
            Viaje sin llamado
          </button>
        </section>
      )}

      <div className="fila">
        {!estado.espera && (
          <button className="boton" style={{ flex: 1 }} onClick={() => setHoja('espera')}>
            Registrar espera
          </button>
        )}
        <button className="boton peligro" style={{ flex: 1 }} onClick={() => setHoja('falla')}>
          Reportar falla
        </button>
      </div>
      {!estado.viaje && (
        <button
          className="enlace"
          onClick={() =>
            void cambiar({ ...VACIO }, { tipo: 'turno_fin', id: estado.turno!.id, fin: ahoraIso() })
          }
        >
          Terminar turno (inició {hora(estado.turno.inicio)})
        </button>
      )}

      {hoja === 'bloque' && (
        <Hoja titulo="¿De qué bloque sale?" alCerrar={() => setHoja(null)}>
          <Opciones
            opciones={props.maestros.puntos
              .filter(
                (p) => p.sede_id === sede && p.tipo === 'bloque' && props.maestros.destino_sugerido[p.id],
              )
              .map((p) => ({ valor: p.id, texto: p.nombre }))}
            elegida={null}
            alElegir={(b) => iniciarViaje(b, null)}
          />
        </Hoja>
      )}
      {hoja === 'espera' && (
        <Hoja titulo="¿Por qué espera?" alCerrar={() => setHoja(null)}>
          <Opciones
            opciones={props.maestros.causas_espera.map((c) => ({ valor: c.codigo, texto: c.nombre }))}
            elegida={null}
            alElegir={(causa) => {
              const espera = { id: nuevoId(), causa, inicio: ahoraIso() };
              void cambiar(
                { ...estado, espera },
                { tipo: 'espera_inicio', ...espera, viaje_id: estado.viaje?.id ?? null },
              );
              setHoja(null);
            }}
          />
        </Hoja>
      )}
      {hoja === 'falla' && (
        <ReportarFalla maestros={props.maestros} sede={sede} alCerrar={() => setHoja(null)} />
      )}
    </main>
  );
}

function ElegirRecurso(props: {
  maestros: Maestros;
  sede: string;
  alElegir: (id: number | null) => void;
  alCerrar: () => void;
}) {
  const recursos = props.maestros.recursos.filter((r) => r.sede_id === props.sede);
  return (
    <Hoja titulo="¿Con qué garrucha o equipo trabaja?" alCerrar={props.alCerrar}>
      <Opciones
        opciones={recursos.map((r) => ({ valor: r.id, texto: r.codigo }))}
        elegida={null}
        alElegir={props.alElegir}
      />
      <button className="boton bloque" onClick={() => props.alElegir(null)}>
        Sin equipo asignado
      </button>
    </Hoja>
  );
}
