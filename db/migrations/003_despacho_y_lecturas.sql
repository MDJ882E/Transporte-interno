-- Piloto con anotador en el bloque y lecturas de código de barras en poscosecha (propuesta del 14 nov. 2026).
-- El transportador puede no tener teléfono: el líder de corte (anotador) registra el llamado, la llegada del
-- transportador y la salida con el contenido; la llegada a poscosecha sale del sistema de código de barras.

-- Código con el que el sistema de poscosecha identifica al transportador (carné).
ALTER TABLE usuario ADD COLUMN codigo_barras text UNIQUE;

-- Cuentas o clientes a los que pertenecen los baldes.
CREATE TABLE cuenta (
  codigo  text PRIMARY KEY,
  nombre  text NOT NULL,
  activo  boolean NOT NULL DEFAULT true
);

ALTER TABLE viaje DROP CONSTRAINT viaje_unidad_check;
ALTER TABLE viaje ADD CONSTRAINT viaje_unidad_check CHECK (unidad IN ('garrucha', 'balde', 'bonche', 'tallo', 'canasta'));
-- Quién creó el registro (el transportador o el anotador del bloque).
ALTER TABLE viaje ADD COLUMN creado_por int REFERENCES usuario(id);
UPDATE viaje SET creado_por = transportador_id;
ALTER TABLE viaje ALTER COLUMN creado_por SET NOT NULL;

-- Contenido de la garrucha: baldes por cuenta.
CREATE TABLE viaje_contenido (
  viaje_id  uuid NOT NULL REFERENCES viaje(id) ON DELETE CASCADE,
  cuenta    text NOT NULL REFERENCES cuenta(codigo),
  baldes    int  NOT NULL CHECK (baldes > 0),
  PRIMARY KEY (viaje_id, cuenta)
);

-- De dónde salió cada evento: la app o una lectura importada de poscosecha.
ALTER TABLE evento_viaje ADD COLUMN origen text NOT NULL DEFAULT 'app' CHECK (origen IN ('app', 'lectura_poscosecha'));

-- Lecturas importadas del sistema de código de barras de poscosecha.
CREATE TABLE lectura_poscosecha (
  id                     serial PRIMARY KEY,
  sede_id                text NOT NULL REFERENCES sede(id),
  codigo_transportador   text NOT NULL,
  transportador_id       int REFERENCES usuario(id),
  baldes                 int NOT NULL CHECK (baldes >= 0),
  ocurrido_en            timestamptz NOT NULL,
  novedad                text,
  viaje_id               uuid UNIQUE REFERENCES viaje(id),
  archivo                text,
  importado_por          int NOT NULL REFERENCES usuario(id),
  importado_en           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sede_id, codigo_transportador, ocurrido_en)
);
CREATE INDEX lectura_sede_fecha ON lectura_poscosecha (sede_id, ocurrido_en);
