import { describe, expect, it } from 'vitest';
import {
  calcularCiclos,
  calcularIndicadores,
  cicloViaje,
  esperaBloque,
  minutosEnVentana,
  type ParametrosSede,
  type ViajeEntrada,
} from '../src/indicadores';

const h = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00-05:00`);

const params: ParametrosSede = {
  sede_id: 'OL',
  fecha: '2026-11-16',
  min_cargue_estandar: 5,
  min_descargue_estandar: 5,
  horas_jornada: 7,
  ventana_inicio: h('00:00'),
  ventana_fin: new Date('2026-11-17T00:00:00-05:00'),
  ahora: h('23:59'),
};

// Viaje tipo del estudio de capacidad (Bloque 47): 28 min esperando en el bloque, ida, cola en recibo, vuelta.
const viajeLargo: ViajeEntrada = {
  id: 'a',
  transportador_id: 1,
  bloque: 'Bloque 47',
  llamado_creado_en: null,
  ciclo_estandar_min: 35.76,
  eventos: {
    llegada_bloque: h('07:00'),
    salida_bloque: h('07:33'), // 33 min en bloque → 28 de espera
    llegada_destino: h('07:44'),
    fin_descargue: h('07:52'), // 8 min → 3 de espera en descargue
    regreso: h('08:04'), // ciclo 64 min
  },
};

const viajeSincronizado: ViajeEntrada = {
  id: 'b',
  transportador_id: 2,
  bloque: 'Bloque 27',
  llamado_creado_en: h('08:00'),
  ciclo_estandar_min: 26.95,
  eventos: {
    llegada_bloque: h('08:06'), // respuesta al llamado: 6 min
    salida_bloque: h('08:11'), // 5 min → sin espera
    llegada_destino: h('08:19'),
    fin_descargue: h('08:24'),
    regreso: h('08:30'), // ciclo 24 min
  },
};

const viajeAbierto: ViajeEntrada = {
  id: 'c',
  transportador_id: 2,
  bloque: 'Bloque 27',
  llamado_creado_en: null,
  ciclo_estandar_min: 26.95,
  eventos: { llegada_bloque: h('09:00'), salida_bloque: h('09:12') }, // 7 de espera, sin cerrar
};

describe('indicadores por viaje', () => {
  it('calcula el ciclo solo con llegada y regreso', () => {
    expect(cicloViaje(viajeLargo)).toBe(64);
    expect(cicloViaje(viajeAbierto)).toBeNull();
  });

  it('descuenta el cargue estándar de la espera en bloque y nunca da negativo', () => {
    expect(esperaBloque(viajeLargo, 5)).toBe(28);
    expect(esperaBloque(viajeSincronizado, 5)).toBe(0);
    expect(esperaBloque({ ...viajeSincronizado, eventos: { ...viajeSincronizado.eventos } }, 10)).toBe(0);
  });

  it('ignora eventos fuera de orden', () => {
    const malo: ViajeEntrada = {
      ...viajeLargo,
      eventos: { llegada_bloque: h('08:00'), regreso: h('07:00') },
    };
    expect(cicloViaje(malo)).toBeNull();
  });
});

describe('minutosEnVentana', () => {
  it('corta intervalos abiertos en la hora actual', () => {
    expect(minutosEnVentana({ inicio: h('06:15'), fin: null }, h('00:00'), h('23:00'), h('08:15'))).toBe(120);
  });
  it('corta en los bordes de la ventana', () => {
    expect(
      minutosEnVentana({ inicio: h('05:00'), fin: h('07:00') }, h('06:00'), h('23:00'), h('23:00')),
    ).toBe(60);
  });
});

describe('calcularIndicadores', () => {
  const turnos = [
    { usuario_id: 1, inicio: h('06:15'), fin: h('13:15') }, // 420 min
    { usuario_id: 2, inicio: h('06:15'), fin: h('13:15') }, // 420 min
  ];
  const fallas = [{ inicio: h('10:00'), fin: h('10:42') }]; // 42 min
  const r = calcularIndicadores(params, [viajeLargo, viajeSincronizado, viajeAbierto], turnos, fallas, 2);

  it('cuenta viajes entregados, incompletos y por transportador', () => {
    expect(r.viajes_entregados).toBe(2);
    expect(r.viajes_incompletos).toBe(1);
    expect(r.transportadores_activos).toBe(2);
    expect(r.viajes_por_transportador).toBe(1);
  });

  it('promedia el ciclo real y el estándar de los mismos viajes', () => {
    expect(r.ciclo_promedio_min).toBe(44);
    expect(r.ciclo_estandar_promedio_min).toBeCloseTo((35.76 + 26.95) / 2, 5);
  });

  it('calcula el % de espera sobre el tiempo de turno', () => {
    // (28 + 0 + 7) / 840
    expect(r.pct_espera_bloque).toBeCloseTo(35 / 840, 6);
    expect(r.espera_bloque_promedio_min).toBeCloseTo(35 / 3, 6);
  });

  it('calcula espera de descargue, respuesta al llamado y disponibilidad', () => {
    expect(r.espera_descargue_promedio_min).toBe(1.5); // (3 + 0) / 2
    expect(r.respuesta_llamado_promedio_min).toBe(6);
    expect(r.disponibilidad_recursos).toBeCloseTo(1 - 42 / 840, 6);
  });

  it('agrupa por bloque', () => {
    const b27 = r.por_bloque.find((b) => b.bloque === 'Bloque 27');
    expect(b27).toMatchObject({ viajes: 1, ciclo_promedio_min: 24, espera_bloque_promedio_min: 3.5 });
  });

  it('devuelve null cuando no hay datos', () => {
    const vacio = calcularIndicadores(params, [], [], [], 0);
    expect(vacio.viajes_por_transportador).toBeNull();
    expect(vacio.pct_espera_bloque).toBeNull();
    expect(vacio.disponibilidad_recursos).toBeNull();
  });
});

describe('piloto con anotador (sin regreso ni turnos)', () => {
  // El anotador marca llegada y salida; la llegada a poscosecha viene de la lectura de código de barras.
  const v = (id: string, t: number, llegada: string, salida: string, destino?: string): ViajeEntrada => ({
    id,
    transportador_id: t,
    bloque: 'Bloque 47',
    llamado_creado_en: null,
    ciclo_estandar_min: 35.76,
    eventos: {
      llegada_bloque: h(llegada),
      salida_bloque: h(salida),
      ...(destino ? { llegada_destino: h(destino) } : {}),
    },
  });
  const viajes = [
    v('1', 7, '07:00', '07:20', '07:31'),
    v('2', 7, '07:50', '07:58', '08:09'), // ciclo del viaje 1: 50 min
    v('3', 7, '12:30', '12:36', '12:47'), // más de 180 min después del 2: el 2 queda sin ciclo
    v('4', 8, '07:10', '07:15'), // sin lectura en poscosecha: no entregado
  ];

  it('mide el ciclo hasta la siguiente llegada del mismo transportador', () => {
    expect(Object.fromEntries(calcularCiclos(viajes))).toEqual({ '1': 50 });
  });

  it('calcula indicadores sin turnos', () => {
    const r = calcularIndicadores(params, viajes, [], [], 0);
    expect(r.viajes_entregados).toBe(3);
    expect(r.viajes_incompletos).toBe(1);
    expect(r.transportadores_activos).toBe(2);
    expect(r.ciclo_promedio_min).toBe(50);
    expect(r.pct_espera_bloque).toBeNull();
    expect(r.espera_bloque_promedio_min).toBeCloseTo((15 + 3 + 1 + 0) / 4, 6);
  });
});
