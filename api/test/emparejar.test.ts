import { describe, expect, it } from 'vitest';
import { emparejar } from '../src/emparejar';

const h = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00-05:00`);

describe('emparejar lecturas con viajes', () => {
  const viajes = [
    { id: 'v1', transportador_id: 1, salida_bloque: h('07:00') },
    { id: 'v2', transportador_id: 1, salida_bloque: h('07:40') },
    { id: 'v3', transportador_id: 2, salida_bloque: h('07:05') },
  ];

  it('asigna cada lectura a la salida más reciente del mismo transportador', () => {
    const r = emparejar(viajes, [
      { clave: 'a', transportador_id: 1, ocurrido_en: h('07:12') },
      { clave: 'b', transportador_id: 1, ocurrido_en: h('07:51') },
      { clave: 'c', transportador_id: 2, ocurrido_en: h('07:20') },
    ]);
    expect(Object.fromEntries(r)).toEqual({ a: 'v1', b: 'v2', c: 'v3' });
  });

  it('no usa un viaje dos veces ni lecturas anteriores a la salida', () => {
    const r = emparejar(viajes, [
      { clave: 'antes', transportador_id: 2, ocurrido_en: h('06:50') },
      { clave: 'x', transportador_id: 2, ocurrido_en: h('07:20') },
      { clave: 'duplicada', transportador_id: 2, ocurrido_en: h('07:25') },
    ]);
    expect(Object.fromEntries(r)).toEqual({ x: 'v3' });
  });

  it('respeta la ventana máxima', () => {
    const r = emparejar(viajes, [{ clave: 'tarde', transportador_id: 2, ocurrido_en: h('09:30') }], 120);
    expect(r.size).toBe(0);
  });
});
