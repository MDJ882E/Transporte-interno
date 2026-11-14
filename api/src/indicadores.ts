// Cálculo de indicadores a partir de eventos con hora. Funciones puras: sin base de datos,
// para poder probarlas con casos conocidos (ver test/indicadores.test.ts).
//
// Definiciones (docs/piloto.md):
//  - Ciclo por viaje           = regreso − llegada al bloque; si no hay regreso (piloto con anotador), llegada al
//                                bloque del siguiente viaje del mismo transportador − llegada al bloque de este viaje,
//                                si ocurre dentro de CICLO_MAX_ENTRE_LLEGADAS_MIN (excluye almuerzo y fin de jornada)
//  - Viaje entregado           = tiene llegada a destino o regreso
//  - Espera en bloque (viaje)  = máx(0, (salida − llegada al bloque) − minutos de cargue estándar)
//  - % espera en bloque        = Σ espera en bloque ÷ Σ minutos de turno en la ventana
//  - Espera en descargue       = máx(0, (fin de descargue − llegada a destino) − minutos de descargue estándar)
//  - Respuesta al llamado      = llegada al bloque − hora del llamado
//  - Viajes por transportador  = viajes entregados ÷ transportadores activos (con turno o con viajes)
//  - Disponibilidad            = 1 − minutos en falla ÷ (recursos activos × minutos de jornada)
import type { Indicadores, TipoEvento } from '@shared/dominio';

export interface ViajeEntrada {
  id: string;
  transportador_id: number;
  bloque: string;
  llamado_creado_en: Date | null;
  ciclo_estandar_min: number | null;
  eventos: Partial<Record<TipoEvento, Date>>;
}

export interface IntervaloEntrada {
  inicio: Date;
  fin: Date | null;
}

export interface TurnoEntrada extends IntervaloEntrada {
  usuario_id: number;
}

export interface ParametrosSede {
  sede_id: string;
  fecha: string; // AAAA-MM-DD
  min_cargue_estandar: number;
  min_descargue_estandar: number;
  horas_jornada: number;
  /** Ventana del día evaluado; los intervalos abiertos se cortan en `ahora`. */
  ventana_inicio: Date;
  ventana_fin: Date;
  ahora: Date;
}

const MIN = 60_000;
export const CICLO_MAX_ENTRE_LLEGADAS_MIN = 180;

export function minutos(desde: Date | undefined | null, hasta: Date | undefined | null): number | null {
  if (!desde || !hasta) return null;
  const m = (hasta.getTime() - desde.getTime()) / MIN;
  return m >= 0 ? m : null; // eventos fuera de orden no se usan
}

export function promedio(valores: readonly (number | null)[]): number | null {
  const v = valores.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Minutos de un intervalo dentro de la ventana; si sigue abierto, se corta en `ahora`. */
export function minutosEnVentana(i: IntervaloEntrada, desde: Date, hasta: Date, ahora: Date): number {
  const fin = i.fin ?? ahora;
  const a = Math.max(i.inicio.getTime(), desde.getTime());
  const b = Math.min(fin.getTime(), hasta.getTime(), ahora.getTime());
  return b > a ? (b - a) / MIN : 0;
}

export function cicloViaje(v: ViajeEntrada): number | null {
  return minutos(v.eventos.llegada_bloque, v.eventos.regreso);
}

export function entregado(v: ViajeEntrada): boolean {
  return Boolean(v.eventos.llegada_destino || v.eventos.regreso);
}

/** Ciclo de cada viaje entregado: por regreso o, si falta, hasta la siguiente llegada del mismo transportador. */
export function calcularCiclos(viajes: readonly ViajeEntrada[]): Map<string, number> {
  const ciclos = new Map<string, number>();
  const porTransportador = new Map<number, ViajeEntrada[]>();
  for (const v of viajes) {
    if (!v.eventos.llegada_bloque) continue;
    porTransportador.set(v.transportador_id, [...(porTransportador.get(v.transportador_id) ?? []), v]);
  }
  for (const lista of porTransportador.values()) {
    lista.sort((a, b) => a.eventos.llegada_bloque!.getTime() - b.eventos.llegada_bloque!.getTime());
    lista.forEach((v, i) => {
      if (!entregado(v)) return;
      const directo = cicloViaje(v);
      if (directo !== null) return ciclos.set(v.id, directo);
      const siguiente = lista[i + 1];
      const entre = minutos(v.eventos.llegada_bloque, siguiente?.eventos.llegada_bloque);
      if (entre !== null && entre <= CICLO_MAX_ENTRE_LLEGADAS_MIN) ciclos.set(v.id, entre);
    });
  }
  return ciclos;
}

export function esperaBloque(v: ViajeEntrada, minCargue: number): number | null {
  const enBloque = minutos(v.eventos.llegada_bloque, v.eventos.salida_bloque);
  return enBloque === null ? null : Math.max(0, enBloque - minCargue);
}

export function esperaDescargue(v: ViajeEntrada, minDescargue: number): number | null {
  const descargue = minutos(v.eventos.llegada_destino, v.eventos.fin_descargue);
  return descargue === null ? null : Math.max(0, descargue - minDescargue);
}

export function calcularIndicadores(
  p: ParametrosSede,
  viajes: readonly ViajeEntrada[],
  turnos: readonly TurnoEntrada[],
  fallas: readonly IntervaloEntrada[],
  recursosActivos: number,
  conciliacion: Pick<Indicadores, 'baldes_anotados' | 'baldes_recibidos' | 'lecturas_sin_emparejar'> = {
    baldes_anotados: 0,
    baldes_recibidos: 0,
    lecturas_sin_emparejar: 0,
  },
): Indicadores {
  const entregados = viajes.filter(entregado);
  const ciclos = calcularCiclos(viajes);
  const ciclo = (v: ViajeEntrada) => ciclos.get(v.id) ?? null;
  const conCiclo = viajes.filter((v) => ciclos.has(v.id));
  const transportadores = new Set([
    ...turnos.map((t) => t.usuario_id),
    ...viajes.map((v) => v.transportador_id),
  ]).size;

  const minutosTurno = turnos.reduce(
    (s, t) => s + minutosEnVentana(t, p.ventana_inicio, p.ventana_fin, p.ahora),
    0,
  );
  const esperas = viajes.map((v) => esperaBloque(v, p.min_cargue_estandar));
  const totalEspera = esperas.reduce<number>((s, e) => s + (e ?? 0), 0);

  const minutosFalla = fallas.reduce(
    (s, f) => s + minutosEnVentana(f, p.ventana_inicio, p.ventana_fin, p.ahora),
    0,
  );
  const minutosProgramados = recursosActivos * p.horas_jornada * 60;

  const bloques = new Map<string, ViajeEntrada[]>();
  for (const v of viajes) bloques.set(v.bloque, [...(bloques.get(v.bloque) ?? []), v]);

  return {
    sede_id: p.sede_id,
    fecha: p.fecha,
    viajes_entregados: entregados.length,
    transportadores_activos: transportadores,
    viajes_por_transportador: transportadores ? entregados.length / transportadores : null,
    ciclo_promedio_min: promedio(conCiclo.map(ciclo)),
    ciclo_estandar_promedio_min: promedio(conCiclo.map((v) => v.ciclo_estandar_min)),
    pct_espera_bloque: minutosTurno > 0 ? Math.min(1, totalEspera / minutosTurno) : null,
    espera_bloque_promedio_min: promedio(esperas),
    espera_descargue_promedio_min: promedio(viajes.map((v) => esperaDescargue(v, p.min_descargue_estandar))),
    respuesta_llamado_promedio_min: promedio(
      viajes.map((v) => minutos(v.llamado_creado_en, v.eventos.llegada_bloque)),
    ),
    disponibilidad_recursos:
      minutosProgramados > 0 ? Math.max(0, 1 - minutosFalla / minutosProgramados) : null,
    viajes_incompletos: viajes.length - entregados.length,
    ...conciliacion,
    por_bloque: [...bloques.entries()]
      .map(([bloque, vs]) => {
        const c = vs.filter((v) => ciclos.has(v.id));
        return {
          bloque,
          viajes: vs.filter(entregado).length,
          ciclo_promedio_min: promedio(c.map(ciclo)),
          // Referencia de la matriz para los viajes entregados del bloque (aunque aún no tengan ciclo medido).
          ciclo_estandar_min: promedio(vs.filter(entregado).map((v) => v.ciclo_estandar_min)),
          espera_bloque_promedio_min: promedio(vs.map((v) => esperaBloque(v, p.min_cargue_estandar))),
        };
      })
      .sort((a, b) => b.viajes - a.viajes || a.bloque.localeCompare(b.bloque, 'es', { numeric: true })),
  };
}
