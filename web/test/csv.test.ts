import { describe, expect, it } from 'vitest';
import {
  adivinarAsignacion,
  agruparLlegadas,
  convertirFilas,
  fechaHoraIso,
  indiceCabecera,
  parsearCsv,
} from '../src/lib/csv';

describe('parsearCsv', () => {
  it('detecta el separador y respeta comillas', () => {
    const f = parsearCsv('﻿Transportador;Baldes;Novedad\r\nT1;12;"Tallo; corto"\r\n\r\nT2;8;\n');
    expect(f).toEqual([
      ['Transportador', 'Baldes', 'Novedad'],
      ['T1', '12', 'Tallo; corto'],
      ['T2', '8', ''],
    ]);
  });
  it('acepta comas', () => {
    expect(parsearCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('fechaHoraIso', () => {
  it('interpreta formatos comunes en hora de Colombia', () => {
    expect(fechaHoraIso('16/11/2026 7:05')).toBe('2026-11-16T12:05:00.000Z');
    expect(fechaHoraIso('2026-11-16 07:05:30')).toBe('2026-11-16T12:05:30.000Z');
    expect(fechaHoraIso('16/11/2026', '1:15 p. m.')).toBe('2026-11-16T18:15:00.000Z');
    expect(fechaHoraIso('2026-11-16T12:05:00Z')).toBe('2026-11-16T12:05:00.000Z');
  });
  it('devuelve null si no entiende', () => {
    expect(fechaHoraIso('ayer')).toBeNull();
  });
});

describe('asignación y conversión', () => {
  const [cab, ...filas] = parsearCsv(
    'Fecha;Hora;Código transportador;Cantidad baldes;Observación\n16/11/2026;07:12;T113;11;Tallo corto\n16/11/2026;07:20;;5;\n16/11/2026;xx;T114;4;',
  );
  const a = adivinarAsignacion(cab!);

  it('adivina las columnas por su nombre', () => {
    expect(a).toEqual({ transportador: 2, baldes: 3, fecha: 0, hora: 1, novedad: 4 });
  });

  it('convierte filas válidas y reporta las malas con su número de fila', () => {
    const r = convertirFilas(filas, a);
    expect(r.lecturas).toEqual([
      {
        codigo_transportador: 'T113',
        baldes: 11,
        ocurrido_en: '2026-11-16T12:12:00.000Z',
        novedad: 'Tallo corto',
      },
    ]);
    expect(r.errores).toEqual([
      { fila: 3, motivo: 'Sin código de transportador' },
      { fila: 4, motivo: 'Fecha u hora no reconocida' },
    ]);
  });
});

it('reconoce las columnas del sistema de poscosecha', () => {
  const a = adivinarAsignacion(['fecdev', 'hora', 'empleado', 'nombre', 'causa1', 'nomcausa', 'Baldes']);
  expect(a).toEqual({ transportador: 2, baldes: 6, fecha: 0, hora: 1, novedad: 5 });
});

// Estructura del informe de detalle del sistema de poscosecha, con datos FICTICIOS.
const INFORME = [
  'Detalles para Baldes - movimiento: 4-Transp;;;;;;',
  ';;;;;;',
  'consec;fecha;empleado;movimiento;ramos;registro;horas;nomcausa;nombre',
  '1;07/11/2026;00000001;4-Transp;26;07/11/2026 12:04;0,166666667;;PERSONA UNO',
  ';07/11/2026;00000001;4-Transp;26;07/11/2026 12:03;0,166666667;;PERSONA UNO',
  ';07/11/2026;00000001;4-Transp;25;07/11/2026 9:57;0,166666667;;PERSONA UNO',
  ';07/11/2026;00000002;4-Transp;16;07/11/2026 9:04;0,166666667;;PERSONA DOS',
  ';07/11/2026;00000002;4-Transp;28;07/11/2026 9:08;0,166666667;Tallo corto;PERSONA DOS',
].join('\r\n');

describe('informe de detalle de poscosecha', () => {
  const todas = parsearCsv(INFORME);
  const filas = todas.slice(indiceCabecera(todas));
  const a = adivinarAsignacion(filas[0]!);

  it('salta el título y usa registro (fecha y hora), empleado y ramos', () => {
    expect(indiceCabecera(todas)).toBe(1);
    expect(filas[0]![0]).toBe('consec');
    expect(a).toEqual({ transportador: 2, baldes: 4, fecha: 5, hora: -1, novedad: 7 });
  });

  it('une filas seguidas del mismo transportador en una llegada', () => {
    const { lecturas, errores } = convertirFilas(filas.slice(1), a);
    expect(errores).toEqual([]);
    expect(agruparLlegadas(lecturas, 5)).toEqual([
      {
        codigo_transportador: '00000002',
        baldes: 44,
        ocurrido_en: '2026-11-07T14:04:00.000Z',
        novedad: 'Tallo corto',
      },
      {
        codigo_transportador: '00000001',
        baldes: 25,
        ocurrido_en: '2026-11-07T14:57:00.000Z',
        novedad: null,
      },
      {
        codigo_transportador: '00000001',
        baldes: 52,
        ocurrido_en: '2026-11-07T17:03:00.000Z',
        novedad: null,
      },
    ]);
  });
});
