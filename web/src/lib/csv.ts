// Lectura del archivo exportado del sistema de código de barras de poscosecha.
// Mientras no se conozca su formato exacto, el usuario indica qué columna es cada dato (asignación de columnas).
import type { Lectura } from '@shared/dominio';

/** Separa un CSV respetando comillas. Detecta ';', ',' o tabulador según la primera línea. */
export function parsearCsv(texto: string): string[][] {
  const limpio = texto.replace(/^\uFEFF/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].reduce((a, b) => (primera.split(b).length > primera.split(a).length ? b : a));
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]!;
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo.trim());
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo.trim());
      if (fila.some((x) => x !== '')) filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }
  fila.push(campo.trim());
  if (fila.some((x) => x !== '')) filas.push(fila);
  return filas;
}

/**
 * Convierte fecha y hora locales a ISO con el desfase de la sede.
 * Acepta 'dd/mm/aaaa hh:mm[:ss]', 'aaaa-mm-dd hh:mm[:ss]', ISO completo y la hora en una columna aparte.
 */
export function fechaHoraIso(fecha: string, hora = '', offset = '-05:00'): string | null {
  const texto = `${fecha} ${hora}`.trim().replace('T', ' ');
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(fecha.trim())) {
    const d = new Date(fecha.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  let a: string, m: string, d: string, resto: string;
  const dmy = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(.*)$/);
  const ymd = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(.*)$/);
  if (dmy) [, d, m, a, resto] = dmy as unknown as [string, string, string, string, string];
  else if (ymd) [, a, m, d, resto] = ymd as unknown as [string, string, string, string, string];
  else return null;
  const h = resto.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP]\.?\s*[mM]\.?)?$/);
  if (!h) return null;
  let hh = Number(h[1]);
  const pm = h[4]?.toLowerCase().startsWith('p');
  if (h[4]) hh = (hh % 12) + (pm ? 12 : 0);
  const p2 = (n: string | number) => String(n).padStart(2, '0');
  const iso = `${a}-${p2(m)}-${p2(d)}T${p2(hh)}:${h[2]}:${h[3] ?? '00'}${offset}`;
  const fechaObj = new Date(iso);
  return Number.isNaN(fechaObj.getTime()) ? null : fechaObj.toISOString();
}

export interface Asignacion {
  transportador: number;
  baldes: number;
  fecha: number;
  /** Columna de hora si viene separada de la fecha; -1 si la fecha ya trae la hora. */
  hora: number;
  /** -1 si no hay columna de novedad. */
  novedad: number;
}

/**
 * Fila de cabecera: la primera con al menos 3 celdas llenas. Los informes de Excel suelen traer antes un título
 * ("Detalles para Baldes - …") y filas vacías.
 */
export function indiceCabecera(filas: string[][]): number {
  const i = filas.findIndex((f) => f.filter((c) => c !== '').length >= 3);
  return i < 0 ? 0 : i;
}

const normal = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();

/** Adivina la asignación por el nombre de las columnas; el usuario puede corregirla. */
export function adivinarAsignacion(cabecera: string[]): Asignacion {
  const nombres = cabecera.map(normal);
  // Primero coincidencia exacta, luego parcial, en el orden de preferencia de las claves.
  const buscar = (...claves: string[]) => {
    for (const k of claves) {
      const i = nombres.indexOf(k);
      if (i >= 0) return i;
    }
    for (const k of claves) {
      const i = nombres.findIndex((c) => c.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };
  // 'registro' (sistema de poscosecha) trae fecha y hora en la misma columna.
  const registro = buscar('registro', 'fecha y hora', 'fecha hora');
  const fecha = registro >= 0 ? registro : buscar('fecha', 'fecdev', 'date');
  const hora = registro >= 0 ? -1 : nombres.findIndex((c) => c === 'hora' || c === 'time');
  return {
    transportador: buscar('empleado', 'transportador', 'codigo', 'carne', 'operario'),
    baldes: buscar('baldes', 'balde', 'ramos', 'cantidad'),
    fecha,
    hora: hora >= 0 && hora !== fecha ? hora : -1,
    novedad: buscar('nomcausa', 'novedad', 'observacion', 'comentario'),
  };
}

/**
 * Une en una sola llegada las lecturas del mismo transportador separadas por pocos minutos
 * (el sistema registra una fila por grupo de ramos; varias filas seguidas son la misma garrucha).
 */
export function agruparLlegadas(lecturas: Lectura[], minutos = 5): Lectura[] {
  const orden = [...lecturas].sort(
    (a, b) =>
      a.codigo_transportador.localeCompare(b.codigo_transportador) ||
      Date.parse(a.ocurrido_en) - Date.parse(b.ocurrido_en),
  );
  const salida: Lectura[] = [];
  let ultimaHora = 0;
  for (const l of orden) {
    const previa = salida.at(-1);
    const t = Date.parse(l.ocurrido_en);
    if (
      previa &&
      previa.codigo_transportador === l.codigo_transportador &&
      t - ultimaHora <= minutos * 60_000
    ) {
      previa.baldes += l.baldes;
      if (l.novedad && !previa.novedad?.includes(l.novedad))
        previa.novedad = previa.novedad ? `${previa.novedad}; ${l.novedad}` : l.novedad;
    } else {
      salida.push({ ...l });
    }
    ultimaHora = t;
  }
  return salida.sort((a, b) => Date.parse(a.ocurrido_en) - Date.parse(b.ocurrido_en));
}

export interface ResultadoLectura {
  lecturas: Lectura[];
  errores: { fila: number; motivo: string }[];
}

export function convertirFilas(filas: string[][], a: Asignacion, offset = '-05:00'): ResultadoLectura {
  const lecturas: Lectura[] = [];
  const errores: ResultadoLectura['errores'] = [];
  filas.forEach((f, i) => {
    const fila = i + 2; // +1 por la cabecera, +1 porque las hojas cuentan desde 1
    const codigo = f[a.transportador]?.trim();
    const baldes = Number((f[a.baldes] ?? '').replace(/\./g, '').replace(',', '.'));
    const iso = fechaHoraIso(f[a.fecha] ?? '', a.hora >= 0 ? (f[a.hora] ?? '') : '', offset);
    if (!codigo) return errores.push({ fila, motivo: 'Sin código de transportador' });
    if (!Number.isInteger(baldes) || baldes < 0)
      return errores.push({ fila, motivo: 'Baldes no es un número entero' });
    if (!iso) return errores.push({ fila, motivo: 'Fecha u hora no reconocida' });
    const novedad = a.novedad >= 0 ? f[a.novedad]?.trim() || null : null;
    lecturas.push({ codigo_transportador: codigo, baldes, ocurrido_en: iso, novedad });
  });
  return { lecturas, errores };
}
