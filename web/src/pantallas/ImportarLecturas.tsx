// Importación del archivo exportado del sistema de código de barras de poscosecha.
// El usuario elige el archivo (CSV), confirma qué columna es cada dato, revisa y envía.
import { useMemo, useState } from 'react';
import type { Maestros, ResultadoImportacion, Sesion } from '@shared/dominio';
import { ErrorApi, post } from '../lib/api';
import {
  adivinarAsignacion,
  agruparLlegadas,
  convertirFilas,
  indiceCabecera,
  parsearCsv,
  type Asignacion,
} from '../lib/csv';

const CAMPOS: { clave: keyof Asignacion; texto: string; opcional?: boolean }[] = [
  { clave: 'transportador', texto: 'Código del transportador' },
  { clave: 'baldes', texto: 'Baldes' },
  { clave: 'fecha', texto: 'Fecha (o fecha y hora)' },
  { clave: 'hora', texto: 'Hora, si viene aparte', opcional: true },
  { clave: 'novedad', texto: 'Novedad', opcional: true },
];

export function ImportarLecturas(props: { sesion: Sesion; maestros: Maestros }) {
  const global = !props.sesion.usuario.sede_id;
  const [sede, setSede] = useState(props.sesion.usuario.sede_id ?? props.maestros.sedes[0]?.id ?? '');
  const [archivo, setArchivo] = useState<string | null>(null);
  const [filas, setFilas] = useState<string[][]>([]);
  const [asignacion, setAsignacion] = useState<Asignacion | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cabecera = filas[0] ?? [];
  const [agrupar, setAgrupar] = useState(5);
  const convertido = useMemo(() => {
    if (!asignacion) return null;
    const r = convertirFilas(filas.slice(1), asignacion);
    return {
      ...r,
      filas: r.lecturas.length,
      lecturas: agrupar > 0 ? agruparLlegadas(r.lecturas, agrupar) : r.lecturas,
    };
  }, [filas, asignacion, agrupar]);
  const completa =
    asignacion && asignacion.transportador >= 0 && asignacion.baldes >= 0 && asignacion.fecha >= 0;

  async function leerArchivo(f: File | undefined) {
    setResultado(null);
    setError(null);
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setError('Exporte el archivo como CSV (en Excel: Guardar como → CSV UTF-8).');
      return;
    }
    const texto = await f.text();
    const todas = parsearCsv(texto);
    const f2 = todas.slice(indiceCabecera(todas));
    if (f2.length < 2) {
      setError('El archivo no tiene filas de datos.');
      return;
    }
    setArchivo(f.name);
    setFilas(f2);
    setAsignacion(adivinarAsignacion(f2[0]!));
  }

  async function enviar() {
    if (!convertido?.lecturas.length) return;
    setEnviando(true);
    setError(null);
    try {
      // Lotes de hasta 5.000 lecturas.
      const total: ResultadoImportacion = {
        leidas: 0,
        nuevas: 0,
        emparejadas: 0,
        sin_transportador: [],
        sin_viaje: 0,
      };
      for (let i = 0; i < convertido.lecturas.length; i += 5000) {
        const r = await post<ResultadoImportacion>('/api/lecturas', {
          sede_id: sede,
          archivo,
          lecturas: convertido.lecturas.slice(i, i + 5000),
        });
        total.leidas += r.leidas;
        total.nuevas += r.nuevas;
        total.emparejadas += r.emparejadas;
        total.sin_viaje = r.sin_viaje;
        total.sin_transportador = [...new Set([...total.sin_transportador, ...r.sin_transportador])];
      }
      setResultado(total);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo importar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="contenedor pila">
      <h1>Importar lecturas de poscosecha</h1>
      <p className="suave">
        Cargue el archivo del sistema de código de barras. Cada lectura se une con la salida del mismo
        transportador desde el bloque y se convierte en su llegada a poscosecha. Puede cargar el mismo archivo
        varias veces: no se duplica.
      </p>
      {global && (
        <label>
          Sede
          <select value={sede} onChange={(e) => setSede(e.target.value)}>
            {props.maestros.sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Archivo CSV
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          onChange={(e) => void leerArchivo(e.target.files?.[0])}
        />
      </label>
      {error && <div className="aviso error">{error}</div>}

      {asignacion && (
        <section className="tarjeta pila">
          <h2>¿Qué columna es cada dato?</h2>
          {CAMPOS.map((c) => (
            <label key={c.clave}>
              {c.texto}
              <select
                value={asignacion[c.clave]}
                onChange={(e) => setAsignacion({ ...asignacion, [c.clave]: Number(e.target.value) })}
              >
                <option value={-1}>{c.opcional ? '— No aplica —' : '— Elija —'}</option>
                {cabecera.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `Columna ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Unir lecturas del mismo transportador separadas por hasta (min)
            <input
              type="number"
              min={0}
              max={30}
              value={agrupar}
              onChange={(e) => setAgrupar(Number(e.target.value))}
            />
          </label>
          <p className="suave pequeno">
            El sistema registra una fila por grupo de ramos; varias filas seguidas del mismo transportador son
            la misma llegada. Use 0 para no unirlas.
          </p>
        </section>
      )}

      {completa && convertido && (
        <section className="pila">
          <div className={`aviso ${convertido.errores.length ? '' : 'ok'}`}>
            {convertido.filas} filas válidas → {convertido.lecturas.length} llegadas
            {convertido.errores.length ? ` · ${convertido.errores.length} filas con problemas` : ''}
          </div>
          {convertido.errores.slice(0, 5).map((e) => (
            <div key={e.fila} className="suave pequeno">
              Fila {e.fila}: {e.motivo}
            </div>
          ))}
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>Transportador</th>
                  <th className="num">Baldes</th>
                  <th>Hora</th>
                  <th>Novedad</th>
                </tr>
              </thead>
              <tbody>
                {convertido.lecturas.slice(0, 5).map((l, i) => (
                  <tr key={i}>
                    <td>{l.codigo_transportador}</td>
                    <td className="num">{l.baldes}</td>
                    <td>{new Date(l.ocurrido_en).toLocaleString('es-CO')}</td>
                    <td>{l.novedad ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="boton primario bloque"
            disabled={enviando || !convertido.lecturas.length}
            onClick={enviar}
          >
            {enviando ? 'Importando…' : `Importar ${convertido.lecturas.length} llegadas`}
          </button>
        </section>
      )}

      {resultado && (
        <section className="tarjeta pila">
          <h2>Resultado</h2>
          <div>
            {resultado.nuevas} lecturas nuevas de {resultado.leidas}. {resultado.emparejadas} unidas a un
            viaje.
          </div>
          {resultado.sin_viaje > 0 && (
            <div className="aviso">
              {resultado.sin_viaje} lecturas sin viaje: el anotador no registró la salida, o pasaron más de 2
              horas entre la salida y la lectura.
            </div>
          )}
          {resultado.sin_transportador.length > 0 && (
            <div className="aviso error">
              Códigos sin transportador asignado: {resultado.sin_transportador.join(', ')}. Asígnelos en
              Usuarios y vuelva a cargar el archivo.
            </div>
          )}
        </section>
      )}
    </main>
  );
}
