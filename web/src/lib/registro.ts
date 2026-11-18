// Punto único para registrar una operación: se guarda en el teléfono y se intenta enviar de inmediato.
import type { OperacionEntrada } from '@shared/dominio';
import { encolar, leerSesion } from './almacen';
import { sincronizar } from './sync';

export const ahoraIso = () => new Date().toISOString();
export const nuevoId = () => crypto.randomUUID();

export async function registrar(...ops: OperacionEntrada[]): Promise<void> {
  const sesion = await leerSesion();
  if (!sesion) throw new Error('No hay sesión');
  for (const op of ops) await encolar(sesion.usuario.id, op);
  if (navigator.vibrate) navigator.vibrate(40);
  void sincronizar();
}
