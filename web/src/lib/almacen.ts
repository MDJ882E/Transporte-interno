// Almacenamiento local en el teléfono (IndexedDB): sesión, datos maestros, estado del turno
// y la cola de operaciones pendientes de enviar. Todo lo que el usuario registra se guarda aquí primero.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Maestros, OperacionEntrada, Sesion } from '@shared/dominio';

export interface OperacionEnCola {
  seq?: number;
  usuario_id: number;
  op: OperacionEntrada;
  creada_en: string;
  intentos: number;
}

export interface Rechazo {
  id: string;
  motivo: string;
  op: OperacionEntrada;
  fecha: string;
}

interface Esquema extends DBSchema {
  kv: { key: string; value: unknown };
  cola: { key: number; value: OperacionEnCola; indexes: { usuario: number } };
  rechazos: { key: string; value: Rechazo };
}

let conexion: Promise<IDBPDatabase<Esquema>> | null = null;

export function db(): Promise<IDBPDatabase<Esquema>> {
  conexion ??= openDB<Esquema>('transporte-interno', 1, {
    upgrade(d) {
      d.createObjectStore('kv');
      d.createObjectStore('cola', { keyPath: 'seq', autoIncrement: true }).createIndex(
        'usuario',
        'usuario_id',
      );
      d.createObjectStore('rechazos', { keyPath: 'id' });
    },
  });
  return conexion;
}

/** Solo para pruebas: olvida la conexión abierta. */
export function reiniciarConexion() {
  conexion = null;
}

export async function leer<T>(clave: string): Promise<T | undefined> {
  return (await (await db()).get('kv', clave)) as T | undefined;
}

export async function guardar(clave: string, valor: unknown): Promise<void> {
  await (await db()).put('kv', valor, clave);
}

export async function borrar(clave: string): Promise<void> {
  await (await db()).delete('kv', clave);
}

export const leerSesion = () => leer<Sesion>('sesion');
export const leerMaestros = () => leer<Maestros>('maestros');

export async function encolar(usuario_id: number, op: OperacionEntrada): Promise<void> {
  await (await db()).add('cola', { usuario_id, op, creada_en: new Date().toISOString(), intentos: 0 });
}

/** Operaciones pendientes del usuario, en el orden en que se registraron. */
export async function pendientes(usuario_id: number, limite = 100): Promise<OperacionEnCola[]> {
  const todas = await (await db()).getAllFromIndex('cola', 'usuario', usuario_id);
  return todas.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).slice(0, limite);
}

export async function contarPendientes(usuario_id: number): Promise<number> {
  return (await db()).countFromIndex('cola', 'usuario', usuario_id);
}

export async function quitarDeCola(seqs: number[]): Promise<void> {
  const tx = (await db()).transaction('cola', 'readwrite');
  await Promise.all([...seqs.map((s) => tx.store.delete(s)), tx.done]);
}

export async function marcarIntento(item: OperacionEnCola): Promise<void> {
  await (await db()).put('cola', { ...item, intentos: item.intentos + 1 });
}

export async function guardarRechazo(r: Rechazo): Promise<void> {
  await (await db()).put('rechazos', r);
}

export async function listarRechazos(): Promise<Rechazo[]> {
  return (await db()).getAll('rechazos');
}

export async function limpiarRechazos(): Promise<void> {
  await (await db()).clear('rechazos');
}
