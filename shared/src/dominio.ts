// Tipos y contratos compartidos entre la API y la app.
// Las operaciones de captura viajan del teléfono al servidor por /api/sync en lotes.
// Cada una lleva un id (UUID) generado en el teléfono, así reenviarla no la duplica.
import { z } from 'zod';

export const ROLES = ['transportador', 'lider_corte', 'recibidor', 'jefe_sede', 'gerencia', 'admin'] as const;
export type Rol = (typeof ROLES)[number];

export const ROL_NOMBRE: Record<Rol, string> = {
  transportador: 'Transportador',
  lider_corte: 'Líder de corte',
  recibidor: 'Recibidor de poscosecha',
  jefe_sede: 'Jefe de sede',
  gerencia: 'Gerencia',
  admin: 'Administrador',
};

/** Roles con alcance global (sin sede asignada). */
export const ROLES_GLOBALES: readonly Rol[] = ['gerencia', 'admin'];

export const PRODUCTOS = ['flor', 'soca', 'esqueje'] as const;
export const UNIDADES = ['garrucha', 'balde', 'bonche', 'tallo', 'canasta'] as const;

/** Orden de los eventos de un viaje de cable vía. */
export const EVENTOS_VIAJE = [
  'llegada_bloque',
  'salida_bloque',
  'llegada_destino',
  'fin_descargue',
  'regreso',
] as const;
export type TipoEvento = (typeof EVENTOS_VIAJE)[number];

export const EVENTO_ACCION: Record<TipoEvento, string> = {
  llegada_bloque: 'Llegué al bloque',
  salida_bloque: 'Salí con carga',
  llegada_destino: 'Llegué a poscosecha',
  fin_descargue: 'Terminé de descargar',
  regreso: 'Regresé',
};

/** Siguiente evento esperado, o null si el viaje está cerrado. */
export function siguienteEvento(registrados: readonly TipoEvento[]): TipoEvento | null {
  for (const e of EVENTOS_VIAJE) if (!registrados.includes(e)) return e;
  return null;
}

const uuid = z.uuid();
const fecha = z.iso.datetime({ offset: true });

export const OperacionSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('turno_inicio'),
    id: uuid,
    recurso_id: z.number().int().nullable(),
    inicio: fecha,
  }),
  z.object({ tipo: z.literal('turno_fin'), id: uuid, fin: fecha }),
  z.object({
    tipo: z.literal('llamado'),
    id: uuid,
    bloque_id: z.number().int(),
    producto: z.enum(PRODUCTOS),
    cantidad_estimada: z.number().positive(),
    creado_en: fecha,
  }),
  z.object({ tipo: z.literal('llamado_cancelar'), id: uuid }),
  z.object({
    tipo: z.literal('viaje'),
    id: uuid,
    /** null = el usuario que envía es el transportador; si lo registra el anotador, el transportador. */
    transportador_id: z.number().int().nullable().default(null),
    turno_id: uuid.nullable(),
    recurso_id: z.number().int().nullable(),
    llamado_id: uuid.nullable(),
    origen_id: z.number().int(),
    destino_id: z.number().int(),
    producto: z.enum(PRODUCTOS),
    cantidad: z.number().positive(),
    unidad: z.enum(UNIDADES),
    /** Baldes por cuenta o cliente. */
    contenido: z
      .array(z.object({ cuenta: z.string().min(1), baldes: z.number().int().positive() }))
      .max(30)
      .default([]),
    creado_en: fecha,
  }),
  /** Contenido definitivo de la garrucha al salir del bloque: reemplaza el anterior y fija la cantidad en baldes. */
  z.object({
    tipo: z.literal('contenido'),
    id: uuid,
    viaje_id: uuid,
    contenido: z
      .array(z.object({ cuenta: z.string().min(1), baldes: z.number().int().positive() }))
      .min(1)
      .max(30),
  }),
  z.object({
    tipo: z.literal('evento'),
    id: uuid,
    viaje_id: uuid,
    evento: z.enum(EVENTOS_VIAJE),
    ocurrido_en: fecha,
  }),
  z.object({
    tipo: z.literal('espera_inicio'),
    id: uuid,
    viaje_id: uuid.nullable(),
    causa: z.string().min(1),
    inicio: fecha,
  }),
  z.object({ tipo: z.literal('espera_fin'), id: uuid, fin: fecha }),
  z.object({
    tipo: z.literal('recibo'),
    id: uuid,
    viaje_id: uuid,
    cantidad: z.number().min(0),
    novedad: z.string().max(500).nullable(),
    ocurrido_en: fecha,
  }),
  z.object({
    tipo: z.literal('falla'),
    id: uuid,
    recurso_id: z.number().int().nullable(),
    punto_id: z.number().int().nullable(),
    tipo_falla: z.string().min(1),
    descripcion: z.string().max(500).nullable(),
    inicio: fecha,
  }),
  z.object({ tipo: z.literal('falla_fin'), id: uuid, fin: fecha }),
]);
export type Operacion = z.infer<typeof OperacionSchema>;
/** Forma en que la app construye una operación (los campos con valor por defecto son opcionales). */
export type OperacionEntrada = z.input<typeof OperacionSchema>;

export const LoteSyncSchema = z.object({ operaciones: z.array(OperacionSchema).min(1).max(200) });

export interface ResultadoSync {
  aplicadas: string[];
  /** Rechazo definitivo (dato inválido o sin permiso): el teléfono lo muestra y no lo reenvía. */
  rechazadas: { id: string; motivo: string }[];
  /** Error temporal del servidor: el teléfono lo conserva y lo reintenta. */
  reintentar: string[];
}

export interface Sesion {
  token: string;
  usuario: { id: number; nombre: string; rol: Rol; sede_id: string | null };
}

export interface Maestros {
  sedes: { id: string; nombre: string; medio: 'cable_via' | 'tractor' }[];
  puntos: { id: number; sede_id: string; codigo: string; nombre: string; tipo: string }[];
  recursos: { id: number; sede_id: string; codigo: string; tipo: string }[];
  causas_espera: { codigo: string; nombre: string }[];
  tipos_falla: { codigo: string; nombre: string; medio: string | null }[];
  cuentas: { codigo: string; nombre: string }[];
  transportadores: { id: number; nombre: string; sede_id: string }[];
  /** Destino sugerido por bloque: el punto de destino con menor ciclo estándar. */
  destino_sugerido: Record<number, number>;
}

export interface Indicadores {
  sede_id: string;
  fecha: string;
  /** Viajes con llegada a destino (lectura de poscosecha o evento) o con regreso. */
  viajes_entregados: number;
  /** Transportadores con turno o con al menos un viaje en el día. */
  transportadores_activos: number;
  viajes_por_transportador: number | null;
  ciclo_promedio_min: number | null;
  ciclo_estandar_promedio_min: number | null;
  /** % del tiempo de turno esperando en el bloque; null si no se registran turnos (piloto con anotador). */
  pct_espera_bloque: number | null;
  espera_bloque_promedio_min: number | null;
  espera_descargue_promedio_min: number | null;
  respuesta_llamado_promedio_min: number | null;
  disponibilidad_recursos: number | null;
  viajes_incompletos: number;
  baldes_anotados: number;
  baldes_recibidos: number;
  lecturas_sin_emparejar: number;
  por_bloque: {
    bloque: string;
    viajes: number;
    ciclo_promedio_min: number | null;
    ciclo_estandar_min: number | null;
    espera_bloque_promedio_min: number | null;
  }[];
}

/** Fila de una lectura del sistema de código de barras de poscosecha, ya interpretada. */
export const LecturaSchema = z.object({
  codigo_transportador: z.string().trim().min(1).max(40),
  baldes: z.number().int().min(0),
  ocurrido_en: fecha,
  novedad: z.string().max(500).nullable(),
});
export type Lectura = z.infer<typeof LecturaSchema>;
export const LoteLecturasSchema = z.object({
  sede_id: z.string().length(2).optional(),
  archivo: z.string().max(200).nullable(),
  lecturas: z.array(LecturaSchema).min(1).max(5000),
});

export interface ResultadoImportacion {
  leidas: number;
  nuevas: number;
  emparejadas: number;
  sin_transportador: string[];
  sin_viaje: number;
}
