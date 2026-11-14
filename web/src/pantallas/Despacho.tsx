// Pantalla del anotador en el bloque (rol líder de corte). Por cada garrucha registra tres momentos:
// 1) garrucha al 90 % (llamado), 2) llegó el transportador, 3) salió con su contenido (baldes por cuenta).
// La llegada a poscosecha llega después desde el sistema de código de barras.
import { useEffect, useMemo, useState } from 'react';
import type { Maestros, OperacionEntrada, Sesion } from '@shared/dominio';
import { guardar, leer } from '../lib/almacen';
import { ahoraIso, nuevoId, registrar } from '../lib/registro';
import { Contador, Hoja, Opciones, haceMin, hora, useReloj } from '../ui';
import { ReportarFalla } from './ReportarFalla';

interface EnBloque {
  viaje_id: string;
  transportador: string;
  llegada: string;
  destino_id: number;
}

interface Despachado {
  viaje_id: string;
  bloque: string;
  transportador: string;
  llegada: string;
  salida: string;
  baldes: number;
}

interface EstadoDespacho {
  bloques: number[];
  llamados: Record<number, { id: string; creado_en: string }>;
  enBloque: Record<number, EnBloque>;
  despachados: Despachado[];
  cuentasRecientes: string[];
}

const VACIO: EstadoDespacho = {
  bloques: [],
  llamados: {},
  enBloque: {},
  despachados: [],
  cuentasRecientes: [],
};
const hoy = () => new Date().toLocaleDateString('en-CA');

export function Despacho(props: { sesion: Sesion; maestros: Maestros }) {
  const sede = props.sesion.usuario.sede_id!;
  const clave = `despacho:${props.sesion.usuario.id}`;
  const [estado, setEstado] = useState<EstadoDespacho | null>(null);
  const [hoja, setHoja] = useState<
    | { tipo: 'bloques' }
    | { tipo: 'llegada'; bloque: number }
    | { tipo: 'salida'; bloque: number }
    | { tipo: 'falla'; bloque: number | null }
    | null
  >(null);
  const ahora = useReloj();

  const bloques = useMemo(
    () =>
      props.maestros.puntos.filter((p) => p.sede_id === sede && (p.tipo === 'bloque' || p.tipo === 'banco')),
    [props.maestros, sede],
  );
  const nombre = (id: number) => props.maestros.puntos.find((p) => p.id === id)?.nombre ?? `Punto ${id}`;

  useEffect(() => {
    void leer<EstadoDespacho & { fecha?: string }>(clave).then((e) => {
      const base = e ?? VACIO;
      // Los despachados se muestran solo del día; lo abierto se conserva.
      setEstado({ ...VACIO, ...base, despachados: e?.fecha === hoy() ? base.despachados : [] });
      if (!e?.bloques.length) setHoja({ tipo: 'bloques' });
    });
  }, [clave]);

  async function actualizar(cambio: (e: EstadoDespacho) => EstadoDespacho, ...ops: OperacionEntrada[]) {
    if (!estado) return;
    const nuevo = cambio(estado);
    setEstado(nuevo);
    await guardar(clave, { ...nuevo, fecha: hoy() });
    if (ops.length) await registrar(...ops);
  }

  if (!estado) return null;

  const llamar = (b: number) => {
    const id = nuevoId();
    const creado_en = ahoraIso();
    return actualizar((e) => ({ ...e, llamados: { ...e.llamados, [b]: { id, creado_en } } }), {
      tipo: 'llamado',
      id,
      bloque_id: b,
      producto: 'flor',
      cantidad_estimada: 1,
      creado_en,
    });
  };

  const cancelarLlamado = (b: number) => {
    const l = estado.llamados[b];
    if (!l) return;
    return actualizar(
      (e) => {
        const { [b]: _, ...resto } = e.llamados;
        return { ...e, llamados: resto };
      },
      { tipo: 'llamado_cancelar', id: l.id },
    );
  };

  return (
    <main className="contenedor pila">
      <div className="fila entre">
        <h1>Despacho en bloque</h1>
        <button className="enlace" onClick={() => setHoja({ tipo: 'bloques' })}>
          Cambiar bloques
        </button>
      </div>

      {estado.bloques.map((b) => {
        const llamado = estado.llamados[b];
        const enBloque = estado.enBloque[b];
        return (
          <section key={b} className={`tarjeta pila ${enBloque ? 'activa' : llamado ? 'espera' : ''}`}>
            <div className="fila entre">
              <h2>{nombre(b)}</h2>
              <span className="suave pequeno">
                {enBloque
                  ? `${enBloque.transportador} llegó ${haceMin(enBloque.llegada, ahora)}`
                  : llamado
                    ? `Llamado ${haceMin(llamado.creado_en, ahora)}`
                    : 'Sin llamado'}
              </span>
            </div>
            {enBloque ? (
              <button
                className="boton primario gigante"
                onClick={() => setHoja({ tipo: 'salida', bloque: b })}
              >
                Salió con carga
              </button>
            ) : (
              <>
                {!llamado && (
                  <button className="boton primario gigante" onClick={() => void llamar(b)}>
                    Garrucha al 90 %
                  </button>
                )}
                <button
                  className={`boton bloque ${llamado ? 'primario gigante' : ''}`}
                  onClick={() => setHoja({ tipo: 'llegada', bloque: b })}
                >
                  Llegó el transportador
                </button>
                {llamado && (
                  <button className="enlace" onClick={() => void cancelarLlamado(b)}>
                    Cancelar llamado
                  </button>
                )}
              </>
            )}
          </section>
        );
      })}

      <button
        className="boton peligro bloque"
        onClick={() => setHoja({ tipo: 'falla', bloque: estado.bloques[0] ?? null })}
      >
        Reportar falla
      </button>

      {estado.despachados.length > 0 && (
        <section className="pila">
          <h2>Despachadas hoy ({estado.despachados.length})</h2>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>Bloque</th>
                  <th>Transportador</th>
                  <th>Llegó</th>
                  <th>Salió</th>
                  <th className="num">Baldes</th>
                </tr>
              </thead>
              <tbody>
                {estado.despachados.map((d) => (
                  <tr key={d.viaje_id}>
                    <td>{d.bloque}</td>
                    <td>{d.transportador}</td>
                    <td>{hora(d.llegada)}</td>
                    <td>{hora(d.salida)}</td>
                    <td className="num">{d.baldes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hoja?.tipo === 'bloques' && (
        <ElegirBloques
          bloques={bloques}
          elegidos={estado.bloques}
          alCerrar={() => setHoja(null)}
          alGuardar={(bs) => {
            void actualizar((e) => ({ ...e, bloques: bs }));
            setHoja(null);
          }}
        />
      )}

      {hoja?.tipo === 'llegada' && (
        <Llegada
          maestros={props.maestros}
          sede={sede}
          bloque={hoja.bloque}
          nombreBloque={nombre(hoja.bloque)}
          alCerrar={() => setHoja(null)}
          alConfirmar={(transportadorId, destinoId) => {
            const b = hoja.bloque;
            const t = props.maestros.transportadores.find((x) => x.id === transportadorId)!;
            const viaje_id = nuevoId();
            const llegada = ahoraIso();
            const llamado = estado.llamados[b];
            setHoja(null);
            void actualizar(
              (e) => {
                const { [b]: _, ...llamados } = e.llamados;
                return {
                  ...e,
                  llamados,
                  enBloque: {
                    ...e.enBloque,
                    [b]: { viaje_id, transportador: t.nombre, llegada, destino_id: destinoId },
                  },
                };
              },
              {
                tipo: 'viaje',
                id: viaje_id,
                transportador_id: transportadorId,
                turno_id: null,
                recurso_id: null,
                llamado_id: llamado?.id ?? null,
                origen_id: b,
                destino_id: destinoId,
                producto: 'flor',
                cantidad: 1,
                unidad: 'garrucha',
                creado_en: llegada,
              },
              { tipo: 'evento', id: nuevoId(), viaje_id, evento: 'llegada_bloque', ocurrido_en: llegada },
            );
          }}
        />
      )}

      {hoja?.tipo === 'salida' && estado.enBloque[hoja.bloque] && (
        <Salida
          maestros={props.maestros}
          recientes={estado.cuentasRecientes}
          titulo={`Salida de ${nombre(hoja.bloque)}`}
          alCerrar={() => setHoja(null)}
          alConfirmar={(contenido) => {
            const b = hoja.bloque;
            const v = estado.enBloque[b]!;
            const salida = ahoraIso();
            const baldes = contenido.reduce((a, x) => a + x.baldes, 0);
            setHoja(null);
            void actualizar(
              (e) => {
                const { [b]: _, ...enBloque } = e.enBloque;
                const usadas = contenido.map((x) => x.cuenta);
                return {
                  ...e,
                  enBloque,
                  despachados: [
                    {
                      viaje_id: v.viaje_id,
                      bloque: nombre(b),
                      transportador: v.transportador,
                      llegada: v.llegada,
                      salida,
                      baldes,
                    },
                    ...e.despachados,
                  ],
                  cuentasRecientes: [
                    ...usadas,
                    ...e.cuentasRecientes.filter((c) => !usadas.includes(c)),
                  ].slice(0, 12),
                };
              },
              { tipo: 'contenido', id: nuevoId(), viaje_id: v.viaje_id, contenido },
              {
                tipo: 'evento',
                id: nuevoId(),
                viaje_id: v.viaje_id,
                evento: 'salida_bloque',
                ocurrido_en: salida,
              },
            );
          }}
        />
      )}

      {hoja?.tipo === 'falla' && (
        <ReportarFalla
          maestros={props.maestros}
          sede={sede}
          puntoId={hoja.bloque}
          alCerrar={() => setHoja(null)}
        />
      )}
    </main>
  );
}

function ElegirBloques(props: {
  bloques: { id: number; nombre: string }[];
  elegidos: number[];
  alGuardar: (b: number[]) => void;
  alCerrar: () => void;
}) {
  const [sel, setSel] = useState<number[]>(props.elegidos);
  const alternar = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Hoja titulo="¿En qué bloques anota hoy?" alCerrar={props.alCerrar}>
      <div className="cuadricula">
        {props.bloques.map((b) => (
          <button
            key={b.id}
            type="button"
            className="opcion"
            aria-pressed={sel.includes(b.id)}
            onClick={() => alternar(b.id)}
          >
            {b.nombre}
          </button>
        ))}
      </div>
      <button className="boton primario bloque" disabled={!sel.length} onClick={() => props.alGuardar(sel)}>
        Guardar ({sel.length})
      </button>
    </Hoja>
  );
}

function Llegada(props: {
  maestros: Maestros;
  sede: string;
  bloque: number;
  nombreBloque: string;
  alConfirmar: (transportadorId: number, destinoId: number) => void;
  alCerrar: () => void;
}) {
  const transportadores = props.maestros.transportadores.filter((t) => t.sede_id === props.sede);
  const destinos = props.maestros.puntos.filter((p) => p.sede_id === props.sede && p.tipo === 'poscosecha');
  const [t, setT] = useState<number | null>(null);
  const [destino, setDestino] = useState<number | null>(
    props.maestros.destino_sugerido[props.bloque] ?? destinos[0]?.id ?? null,
  );
  return (
    <Hoja titulo={`¿Quién llegó a ${props.nombreBloque}?`} alCerrar={props.alCerrar}>
      <Opciones
        opciones={transportadores.map((x) => ({ valor: x.id, texto: x.nombre }))}
        elegida={t}
        alElegir={setT}
      />
      {destinos.length > 1 && (
        <>
          <h3>Lleva la flor a</h3>
          <Opciones
            opciones={destinos.map((d) => ({ valor: d.id, texto: d.nombre }))}
            elegida={destino}
            alElegir={setDestino}
          />
        </>
      )}
      <button
        className="boton primario gigante"
        disabled={t === null || destino === null}
        onClick={() => props.alConfirmar(t!, destino!)}
      >
        Confirmar llegada
      </button>
    </Hoja>
  );
}

function Salida(props: {
  maestros: Maestros;
  recientes: string[];
  titulo: string;
  alConfirmar: (contenido: { cuenta: string; baldes: number }[]) => void;
  alCerrar: () => void;
}) {
  const [baldes, setBaldes] = useState<Record<string, number>>({});
  const [buscar, setBuscar] = useState('');
  const orden = (c: string) => {
    const i = props.recientes.indexOf(c);
    return i < 0 ? 999 : i;
  };
  const cuentas = [...props.maestros.cuentas]
    .sort((a, b) => orden(a.codigo) - orden(b.codigo) || a.nombre.localeCompare(b.nombre, 'es'))
    .filter((c) => !buscar || `${c.codigo} ${c.nombre}`.toLowerCase().includes(buscar.toLowerCase()));
  const total = Object.values(baldes).reduce((a, b) => a + b, 0);
  const contenido = Object.entries(baldes)
    .filter(([, n]) => n > 0)
    .map(([cuenta, n]) => ({ cuenta, baldes: n }));

  return (
    <Hoja titulo={props.titulo} alCerrar={props.alCerrar}>
      <p className="suave">Baldes por cuenta o cliente.</p>
      {props.maestros.cuentas.length > 6 && (
        <input
          placeholder="Buscar cuenta"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          aria-label="Buscar cuenta"
        />
      )}
      {cuentas.map((c) => (
        <div key={c.codigo} className="pila" style={{ gap: 4 }}>
          <span>
            <strong>{c.nombre}</strong> <span className="suave pequeno">{c.codigo}</span>
          </span>
          <Contador
            etiqueta={`Baldes de ${c.nombre}`}
            valor={baldes[c.codigo] ?? 0}
            alCambiar={(n) => setBaldes((b) => ({ ...b, [c.codigo]: n }))}
          />
        </div>
      ))}
      {!props.maestros.cuentas.length && (
        <div className="aviso">No hay cuentas cargadas. Pida al administrador que las cargue.</div>
      )}
      <button
        className="boton primario gigante"
        disabled={!total}
        onClick={() => props.alConfirmar(contenido)}
      >
        Confirmar salida · {total} baldes
      </button>
    </Hoja>
  );
}
