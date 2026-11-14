-- Esquema base del transporte interno.
-- Regla: los tiempos de ciclo y de espera NO se guardan; se calculan a partir de
-- los eventos con hora (tabla evento_viaje). Así no hay datos digitados que maquillen indicadores.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- Maestros

CREATE TABLE sede (
  id                   text PRIMARY KEY CHECK (id ~ '^[A-Z]{2}$'),       -- OL, MT, FE
  nombre               text NOT NULL,
  medio                text NOT NULL CHECK (medio IN ('cable_via', 'tractor')),
  inicio_jornada       time NOT NULL DEFAULT '06:15',
  horas_jornada        numeric(4,2) NOT NULL DEFAULT 7 CHECK (horas_jornada > 0),
  min_cargue_estandar  numeric(5,2) NOT NULL DEFAULT 5 CHECK (min_cargue_estandar >= 0),  -- cambio de garrucha en bloque
  min_descargue_estandar numeric(5,2) NOT NULL DEFAULT 5 CHECK (min_descargue_estandar >= 0), -- entrega en poscosecha
  velocidad_m_min      numeric(6,2)                                       -- 55 m/min en Olas; null si no se ha medido
);

CREATE TABLE punto (
  id        serial PRIMARY KEY,
  sede_id   text NOT NULL REFERENCES sede(id),
  codigo    text NOT NULL,                       -- 'B27', 'POS1', 'COMP'
  nombre    text NOT NULL,                       -- 'Bloque 27', 'Poscosecha Olas1'
  tipo      text NOT NULL CHECK (tipo IN ('bloque', 'poscosecha', 'compostera', 'banco')),
  area_ha   numeric(6,2),
  activo    boolean NOT NULL DEFAULT true,
  UNIQUE (sede_id, codigo)
);

-- Distancia y ciclo estándar por par origen-destino (importados de las matrices OD).
-- La matriz de Olas es asimétrica por los sentidos del cable: se guarda tal cual.
CREATE TABLE distancia (
  origen_id          int NOT NULL REFERENCES punto(id) ON DELETE CASCADE,
  destino_id         int NOT NULL REFERENCES punto(id) ON DELETE CASCADE,
  metros             numeric(8,1) NOT NULL CHECK (metros >= 0),
  ciclo_estandar_min numeric(6,2) CHECK (ciclo_estandar_min >= 0),   -- ida + vuelta + cargue + descargue
  PRIMARY KEY (origen_id, destino_id),
  CHECK (origen_id <> destino_id)
);

CREATE TABLE recurso (
  id         serial PRIMARY KEY,
  sede_id    text NOT NULL REFERENCES sede(id),
  codigo     text NOT NULL,
  tipo       text NOT NULL CHECK (tipo IN ('garrucha', 'tractor', 'remolque')),
  capacidad  numeric(8,1),
  unidad     text CHECK (unidad IN ('garrucha', 'bonche', 'tallo', 'canasta')),
  activo     boolean NOT NULL DEFAULT true,
  UNIQUE (sede_id, codigo)
);

CREATE TABLE causa_espera (
  codigo  text PRIMARY KEY,
  nombre  text NOT NULL,
  orden   int NOT NULL DEFAULT 0
);

CREATE TABLE tipo_falla (
  codigo  text PRIMARY KEY,
  nombre  text NOT NULL,
  medio   text CHECK (medio IN ('cable_via', 'tractor')),   -- null = aplica a ambos
  orden   int NOT NULL DEFAULT 0
);

-- Roles: ver README.md. sede_id null solo para gerencia y admin (alcance global).
CREATE TABLE usuario (
  id         serial PRIMARY KEY,
  documento  text NOT NULL UNIQUE,
  nombre     text NOT NULL,
  rol        text NOT NULL CHECK (rol IN ('transportador', 'lider_corte', 'recibidor', 'jefe_sede', 'gerencia', 'admin')),
  sede_id    text REFERENCES sede(id),
  pin_hash   text NOT NULL,
  activo     boolean NOT NULL DEFAULT true,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  CHECK (sede_id IS NOT NULL OR rol IN ('gerencia', 'admin'))
);

-- ---------------------------------------------------------------- Operación
-- Los id son UUID generados en el teléfono: un registro creado sin señal conserva
-- su id al sincronizar, y reenviarlo no lo duplica (ON CONFLICT DO NOTHING).
-- Cada tabla guarda la hora del dispositivo (ocurrido_en / inicio) y la de llegada al servidor (recibido_en).

CREATE TABLE turno (
  id           uuid PRIMARY KEY,
  sede_id      text NOT NULL REFERENCES sede(id),
  usuario_id   int  NOT NULL REFERENCES usuario(id),
  recurso_id   int  REFERENCES recurso(id),
  inicio       timestamptz NOT NULL,
  fin          timestamptz,
  recibido_en  timestamptz NOT NULL DEFAULT now(),
  CHECK (fin IS NULL OR fin > inicio)
);

CREATE TABLE llamado (
  id                 uuid PRIMARY KEY,
  sede_id            text NOT NULL REFERENCES sede(id),
  bloque_id          int  NOT NULL REFERENCES punto(id),
  producto           text NOT NULL DEFAULT 'flor' CHECK (producto IN ('flor', 'soca', 'esqueje')),
  cantidad_estimada  numeric(8,1) NOT NULL DEFAULT 1 CHECK (cantidad_estimada > 0),
  creado_por         int  NOT NULL REFERENCES usuario(id),
  creado_en          timestamptz NOT NULL,
  estado             text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'asignado', 'atendido', 'cancelado')),
  asignado_a         int  REFERENCES usuario(id),
  asignado_en        timestamptz,
  recibido_en        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE viaje (
  id                uuid PRIMARY KEY,
  sede_id           text NOT NULL REFERENCES sede(id),
  transportador_id  int  NOT NULL REFERENCES usuario(id),
  turno_id          uuid REFERENCES turno(id),
  recurso_id        int  REFERENCES recurso(id),
  llamado_id        uuid REFERENCES llamado(id),
  origen_id         int  NOT NULL REFERENCES punto(id),
  destino_id        int  NOT NULL REFERENCES punto(id),
  producto          text NOT NULL DEFAULT 'flor' CHECK (producto IN ('flor', 'soca', 'esqueje')),
  cantidad          numeric(8,1) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  unidad            text NOT NULL DEFAULT 'garrucha' CHECK (unidad IN ('garrucha', 'bonche', 'tallo', 'canasta')),
  anulado           boolean NOT NULL DEFAULT false,
  creado_en         timestamptz NOT NULL,
  recibido_en       timestamptz NOT NULL DEFAULT now(),
  CHECK (origen_id <> destino_id)
);

-- Secuencia de un viaje de cable vía:
-- llegada_bloque → salida_bloque → llegada_destino → fin_descargue → regreso
CREATE TABLE evento_viaje (
  id              uuid PRIMARY KEY,
  viaje_id        uuid NOT NULL REFERENCES viaje(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('llegada_bloque', 'salida_bloque', 'llegada_destino', 'fin_descargue', 'regreso')),
  ocurrido_en     timestamptz NOT NULL,
  registrado_por  int NOT NULL REFERENCES usuario(id),
  recibido_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (viaje_id, tipo)
);

CREATE TABLE espera (
  id           uuid PRIMARY KEY,
  sede_id      text NOT NULL REFERENCES sede(id),
  usuario_id   int  NOT NULL REFERENCES usuario(id),
  viaje_id     uuid REFERENCES viaje(id),
  causa        text NOT NULL REFERENCES causa_espera(codigo),
  inicio       timestamptz NOT NULL,
  fin          timestamptz,
  recibido_en  timestamptz NOT NULL DEFAULT now(),
  CHECK (fin IS NULL OR fin >= inicio)
);

CREATE TABLE recibo (
  id            uuid PRIMARY KEY,
  viaje_id      uuid NOT NULL UNIQUE REFERENCES viaje(id),
  recibido_por  int  NOT NULL REFERENCES usuario(id),
  ocurrido_en   timestamptz NOT NULL,
  cantidad      numeric(8,1) NOT NULL CHECK (cantidad >= 0),
  novedad       text,
  recibido_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE falla (
  id             uuid PRIMARY KEY,
  sede_id        text NOT NULL REFERENCES sede(id),
  recurso_id     int  REFERENCES recurso(id),
  punto_id       int  REFERENCES punto(id),
  tipo           text NOT NULL REFERENCES tipo_falla(codigo),
  descripcion    text,
  inicio         timestamptz NOT NULL,
  fin            timestamptz,
  reportado_por  int NOT NULL REFERENCES usuario(id),
  recibido_en    timestamptz NOT NULL DEFAULT now(),
  CHECK (fin IS NULL OR fin >= inicio)
);

CREATE INDEX viaje_sede_fecha   ON viaje (sede_id, creado_en);
CREATE INDEX evento_viaje_viaje ON evento_viaje (viaje_id);
CREATE INDEX llamado_pendiente  ON llamado (sede_id, estado, creado_en);
CREATE INDEX turno_sede_fecha   ON turno (sede_id, inicio);
CREATE INDEX espera_sede_fecha  ON espera (sede_id, inicio);
CREATE INDEX falla_sede_fecha   ON falla (sede_id, inicio);
