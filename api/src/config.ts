// Configuración leída de variables de entorno (ver .env.example).
function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

export const config = {
  databaseUrl: requerida('DATABASE_URL'),
  jwtSecret:
    process.env.JWT_SECRET ??
    (process.env.NODE_ENV === 'production' ? requerida('JWT_SECRET') : 'solo-desarrollo'),
  puerto: Number(process.env.PORT ?? 3000),
  /** Zona horaria de las sedes (Colombia, sin horario de verano). */
  offsetZona: process.env.OFFSET_ZONA ?? '-05:00',
  /** Duración de la sesión en el teléfono: un turno largo más margen. */
  duracionSesion: process.env.DURACION_SESION ?? '14h',
  origenesPermitidos: (process.env.ORIGENES_PERMITIDOS ?? '').split(',').filter(Boolean),
};
