// Empareja las lecturas de código de barras de poscosecha con los viajes despachados desde el bloque.
// Regla: cada lectura se asigna al viaje del mismo transportador cuya salida del bloque es la más reciente
// anterior a la lectura, dentro de una ventana máxima, y que todavía no tenga llegada a destino.
// Cada viaje recibe como máximo una lectura. Función pura: ver test/emparejar.test.ts.

export interface ViajeAbierto {
  id: string;
  transportador_id: number;
  salida_bloque: Date;
}

export interface LecturaPorEmparejar {
  clave: number | string;
  transportador_id: number;
  ocurrido_en: Date;
}

/** Ventana máxima entre la salida del bloque y la lectura en poscosecha. */
export const VENTANA_EMPAREJAR_MIN = 120;

export function emparejar(
  viajes: readonly ViajeAbierto[],
  lecturas: readonly LecturaPorEmparejar[],
  ventanaMin = VENTANA_EMPAREJAR_MIN,
): Map<LecturaPorEmparejar['clave'], string> {
  const usados = new Set<string>();
  const resultado = new Map<LecturaPorEmparejar['clave'], string>();
  const ordenadas = [...lecturas].sort((a, b) => a.ocurrido_en.getTime() - b.ocurrido_en.getTime());
  for (const l of ordenadas) {
    const t = l.ocurrido_en.getTime();
    let mejor: ViajeAbierto | undefined;
    for (const v of viajes) {
      if (v.transportador_id !== l.transportador_id || usados.has(v.id)) continue;
      const s = v.salida_bloque.getTime();
      if (s > t || t - s > ventanaMin * 60_000) continue;
      if (!mejor || s > mejor.salida_bloque.getTime()) mejor = v;
    }
    if (mejor) {
      usados.add(mejor.id);
      resultado.set(l.clave, mejor.id);
    }
  }
  return resultado;
}
