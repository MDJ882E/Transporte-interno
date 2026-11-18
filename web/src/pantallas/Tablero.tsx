// Tablero diario por sede (jefe de sede, líder) y comparativo entre sedes (gerencia y administración).
import { useCallback, useEffect, useState } from 'react';
import type { Indicadores, Maestros, Sesion } from '@shared/dominio';
import { api, ErrorApi } from '../lib/api';
import { hora } from '../ui';

const hoy = () => new Date().toLocaleDateString('en-CA');
const n = (v: number | null, dec = 1) =>
  v === null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: dec });
const pct = (v: number | null) =>
  v === null ? '—' : `${(v * 100).toLocaleString('es-CO', { maximumFractionDigits: 0 })} %`;

/** Metas del estudio de capacidad de Olas (nov. 2025). */
const META_ESPERA = 0.15;

interface Falla {
  id: string;
  tipo_nombre: string;
  descripcion: string | null;
  inicio: string;
  punto: string | null;
  recurso: string | null;
  reportado_por: string;
}

export function Tablero(props: { sesion: Sesion; maestros: Maestros }) {
  const global = !props.sesion.usuario.sede_id;
  const [sede, setSede] = useState(props.sesion.usuario.sede_id ?? props.maestros.sedes[0]?.id ?? 'OL');
  const [fecha, setFecha] = useState(hoy());
  const [datos, setDatos] = useState<Indicadores | null>(null);
  const [comparativo, setComparativo] = useState<Indicadores[]>([]);
  const [fallas, setFallas] = useState<Falla[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setError(null);
      const [d, f, c] = await Promise.all([
        api<Indicadores>(`/api/tablero?sede=${sede}&fecha=${fecha}`),
        api<Falla[]>(`/api/fallas?sede=${sede}`),
        global ? api<Indicadores[]>(`/api/tablero/sedes?fecha=${fecha}`) : Promise.resolve([]),
      ]);
      setDatos(d);
      setFallas(f);
      setComparativo(c);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar el tablero.');
    }
  }, [sede, fecha, global]);

  useEffect(() => {
    void cargar();
    const i = setInterval(() => void cargar(), 60_000);
    return () => clearInterval(i);
  }, [cargar]);

  async function exportar() {
    try {
      const blob = await api<Blob>(`/api/exportar/viajes.csv?sede=${sede}&desde=${fecha}&hasta=${fecha}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `viajes_${sede}_${fecha}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo exportar.');
    }
  }

  const puedeExportar = props.sesion.usuario.rol !== 'lider_corte';
  const nombreSede = (id: string) => props.maestros.sedes.find((s) => s.id === id)?.nombre ?? id;

  return (
    <main className="contenedor ancho pila">
      <div className="fila entre">
        <h1>Tablero de transporte · {nombreSede(sede)}</h1>
        <div className="fila">
          {global && (
            <select value={sede} onChange={(e) => setSede(e.target.value)} aria-label="Sede">
              {props.maestros.sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={fecha}
            max={hoy()}
            onChange={(e) => setFecha(e.target.value)}
            aria-label="Fecha"
          />
          {puedeExportar && (
            <button className="boton" onClick={exportar}>
              Exportar a Excel
            </button>
          )}
        </div>
      </div>
      {error && <div className="aviso error">{error}</div>}

      {datos && (
        <>
          <section className="kpis" aria-label="Indicadores del día">
            <Kpi
              titulo="Viajes entregados"
              valor={String(datos.viajes_entregados)}
              meta={`${datos.viajes_incompletos} sin llegada a poscosecha`}
            />
            <Kpi
              titulo="Viajes por transportador"
              valor={n(datos.viajes_por_transportador)}
              meta={`${datos.transportadores_activos} transportadores activos`}
            />
            <Kpi
              titulo="Ciclo promedio"
              valor={`${n(datos.ciclo_promedio_min, 0)} min`}
              meta={`Estándar ${n(datos.ciclo_estandar_promedio_min, 0)} min`}
              estado={
                datos.ciclo_promedio_min !== null && datos.ciclo_estandar_promedio_min !== null
                  ? datos.ciclo_promedio_min <= datos.ciclo_estandar_promedio_min * 1.15
                  : null
              }
            />
            {datos.pct_espera_bloque !== null ? (
              <Kpi
                titulo="Espera en bloque"
                valor={pct(datos.pct_espera_bloque)}
                meta={`Meta ≤ ${pct(META_ESPERA)} del turno · ${n(datos.espera_bloque_promedio_min)} min/viaje`}
                estado={datos.pct_espera_bloque <= META_ESPERA}
              />
            ) : (
              <Kpi
                titulo="Espera en bloque"
                valor={`${n(datos.espera_bloque_promedio_min)} min`}
                meta="Por viaje: llegada → salida, menos el cargue estándar"
              />
            )}
            <Kpi
              titulo="Respuesta al llamado"
              valor={`${n(datos.respuesta_llamado_promedio_min, 0)} min`}
              meta="Llamado → llegada al bloque"
            />
            <Kpi
              titulo="Espera en descargue"
              valor={`${n(datos.espera_descargue_promedio_min)} min`}
              meta="Sobre el estándar, por viaje"
            />
            <Kpi
              titulo="Baldes anotados / recibidos"
              valor={`${datos.baldes_anotados} / ${datos.baldes_recibidos}`}
              meta={`${datos.lecturas_sin_emparejar} lecturas sin emparejar`}
              estado={datos.baldes_anotados ? datos.baldes_anotados === datos.baldes_recibidos : null}
            />
            <Kpi
              titulo="Disponibilidad de equipos"
              valor={pct(datos.disponibilidad_recursos)}
              meta={`${fallas.length} fallas abiertas`}
            />
          </section>
          <p className="suave pequeno">
            Sin regreso registrado, el ciclo se mide entre dos llegadas seguidas del mismo transportador al
            bloque (máximo 3 h).
          </p>

          <section className="pila">
            <h2>Por bloque</h2>
            <div className="tabla-envoltura">
              <table>
                <thead>
                  <tr>
                    <th>Bloque</th>
                    <th className="num">Viajes</th>
                    <th className="num">Ciclo real (min)</th>
                    <th className="num">Ciclo estándar (min)</th>
                    <th className="num">Espera en bloque (min/viaje)</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.por_bloque.map((b) => (
                    <tr key={b.bloque}>
                      <td>{b.bloque}</td>
                      <td className="num">{b.viajes}</td>
                      <td className="num">{n(b.ciclo_promedio_min, 0)}</td>
                      <td className="num">{n(b.ciclo_estandar_min, 0)}</td>
                      <td className="num">{n(b.espera_bloque_promedio_min)}</td>
                    </tr>
                  ))}
                  {!datos.por_bloque.length && (
                    <tr>
                      <td colSpan={5} className="suave">
                        Sin viajes registrados en la fecha.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {fallas.length > 0 && (
        <section className="pila">
          <h2>Fallas abiertas</h2>
          {fallas.map((f) => (
            <div key={f.id} className="tarjeta">
              <strong>{f.tipo_nombre}</strong> · {f.punto ?? f.recurso ?? 'sin ubicación'} · desde{' '}
              {hora(f.inicio)} · <span className="suave">{f.reportado_por}</span>
              {f.descripcion && <div className="suave">{f.descripcion}</div>}
            </div>
          ))}
        </section>
      )}

      {global && comparativo.length > 0 && (
        <section className="pila">
          <h2>Comparativo de sedes</h2>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>Sede</th>
                  <th className="num">Viajes</th>
                  <th className="num">Viajes/transportador</th>
                  <th className="num">Ciclo real (min)</th>
                  <th className="num">Ciclo estándar (min)</th>
                  <th className="num">Espera en bloque (min/viaje)</th>
                  <th className="num">Disponibilidad</th>
                </tr>
              </thead>
              <tbody>
                {comparativo.map((c) => (
                  <tr key={c.sede_id}>
                    <td>{nombreSede(c.sede_id)}</td>
                    <td className="num">{c.viajes_entregados}</td>
                    <td className="num">{n(c.viajes_por_transportador)}</td>
                    <td className="num">{n(c.ciclo_promedio_min, 0)}</td>
                    <td className="num">{n(c.ciclo_estandar_promedio_min, 0)}</td>
                    <td className="num">{n(c.espera_bloque_promedio_min)} min</td>
                    <td className="num">{pct(c.disponibilidad_recursos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Kpi(props: { titulo: string; valor: string; meta: string; estado?: boolean | null }) {
  const clase = props.estado === true ? 'bueno' : props.estado === false ? 'malo' : '';
  return (
    <div className={`kpi ${clase}`}>
      <div className="pequeno suave">{props.titulo}</div>
      <div className="valor">{props.valor}</div>
      <div className="meta">{props.meta}</div>
    </div>
  );
}
