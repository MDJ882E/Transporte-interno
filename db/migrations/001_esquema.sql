-- Esquema base del transporte interno (SQL Server / Azure SQL Database).
-- Regla: los tiempos de ciclo y de espera NO se guardan; se calculan a partir de
-- los eventos con hora (tabla evento_viaje). Así no hay datos digitados que maquillen indicadores.
-- Las fechas se guardan como DATETIMEOFFSET: conservan la zona horaria del dispositivo.
-- Cada lote separado por GO se ejecuta por aparte, dentro de una sola transacción.

-- ---------------------------------------------------------------- Maestros

CREATE TABLE sede (
  id                     NVARCHAR(2) PRIMARY KEY CHECK (id COLLATE Latin1_General_BIN2 LIKE '[A-Z][A-Z]'), -- OL, MT, FE
  nombre                 NVARCHAR(100) NOT NULL,
  medio                  NVARCHAR(20) NOT NULL CHECK (medio IN ('cable_via', 'tractor')),
  inicio_jornada         TIME(0) NOT NULL DEFAULT '06:15',
  horas_jornada          DECIMAL(4,2) NOT NULL DEFAULT 7 CHECK (horas_jornada > 0),
  min_cargue_estandar    DECIMAL(5,2) NOT NULL DEFAULT 5 CHECK (min_cargue_estandar >= 0),    -- cambio de garrucha en bloque
  min_descargue_estandar DECIMAL(5,2) NOT NULL DEFAULT 5 CHECK (min_descargue_estandar >= 0), -- entrega en poscosecha
  velocidad_m_min        DECIMAL(6,2) NULL                                                     -- 55 m/min en Olas; null si no se ha medido
);

CREATE TABLE punto (
  id        INT IDENTITY PRIMARY KEY,
  sede_id   NVARCHAR(2) NOT NULL REFERENCES sede(id),
  codigo    NVARCHAR(20) NOT NULL,                 -- 'B27', 'POS1', 'COMP'
  nombre    NVARCHAR(100) NOT NULL,                -- 'Bloque 27', 'Poscosecha Olas1'
  tipo      NVARCHAR(20) NOT NULL CHECK (tipo IN ('bloque', 'poscosecha', 'compostera', 'banco')),
  area_ha   DECIMAL(6,2) NULL,
  activo    BIT NOT NULL DEFAULT 1,
  CONSTRAINT punto_sede_codigo UNIQUE (sede_id, codigo)
);

-- Distancia y ciclo estándar por par origen-destino (importados de las matrices OD).
-- La matriz de Olas es asimétrica por los sentidos del cable: se guarda tal cual.
-- SQL Server no admite dos borrados en cascada hacia la misma tabla: los puntos se desactivan, no se borran.
CREATE TABLE distancia (
  origen_id          INT NOT NULL REFERENCES punto(id),
  destino_id         INT NOT NULL REFERENCES punto(id),
  metros             DECIMAL(8,1) NOT NULL CHECK (metros >= 0),
  ciclo_estandar_min DECIMAL(6,2) NULL CHECK (ciclo_estandar_min >= 0),   -- ida + vuelta + cargue + descargue
  PRIMARY KEY (origen_id, destino_id),
  CHECK (origen_id <> destino_id)
);

CREATE TABLE recurso (
  id         INT IDENTITY PRIMARY KEY,
  sede_id    NVARCHAR(2) NOT NULL REFERENCES sede(id),
  codigo     NVARCHAR(20) NOT NULL,
  tipo       NVARCHAR(20) NOT NULL CHECK (tipo IN ('garrucha', 'tractor', 'remolque')),
  capacidad  DECIMAL(8,1) NULL,
  unidad     NVARCHAR(20) NULL CHECK (unidad IN ('garrucha', 'balde', 'bonche', 'tallo', 'canasta')),
  activo     BIT NOT NULL DEFAULT 1,
  CONSTRAINT recurso_sede_codigo UNIQUE (sede_id, codigo)
);

CREATE TABLE causa_espera (
  codigo  NVARCHAR(40) PRIMARY KEY,
  nombre  NVARCHAR(100) NOT NULL,
  orden   INT NOT NULL DEFAULT 0
);

CREATE TABLE tipo_falla (
  codigo  NVARCHAR(40) PRIMARY KEY,
  nombre  NVARCHAR(100) NOT NULL,
  medio   NVARCHAR(20) NULL CHECK (medio IN ('cable_via', 'tractor')),   -- null = aplica a ambos
  orden   INT NOT NULL DEFAULT 0
);

-- Cuentas o clientes a los que pertenecen los baldes.
CREATE TABLE cuenta (
  codigo  NVARCHAR(40) PRIMARY KEY,
  nombre  NVARCHAR(150) NOT NULL,
  activo  BIT NOT NULL DEFAULT 1
);

-- Roles: ver README.md. sede_id null solo para gerencia y admin (alcance global).
CREATE TABLE usuario (
  id             INT IDENTITY PRIMARY KEY,
  documento      NVARCHAR(20) NOT NULL CONSTRAINT usuario_documento UNIQUE,
  nombre         NVARCHAR(150) NOT NULL,
  rol            NVARCHAR(20) NOT NULL CHECK (rol IN ('transportador', 'lider_corte', 'recibidor', 'jefe_sede', 'gerencia', 'admin')),
  sede_id        NVARCHAR(2) NULL REFERENCES sede(id),
  pin_hash       NVARCHAR(100) NOT NULL,
  -- Código con el que el sistema de poscosecha identifica al transportador (carné).
  codigo_barras  NVARCHAR(40) NULL,
  activo         BIT NOT NULL DEFAULT 1,
  creado_en      DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CHECK (sede_id IS NOT NULL OR rol IN ('gerencia', 'admin'))
);
CREATE UNIQUE INDEX usuario_codigo_barras ON usuario (codigo_barras) WHERE codigo_barras IS NOT NULL;

-- ---------------------------------------------------------------- Operación
-- Los id son UUID generados en el teléfono: un registro creado sin señal conserva
-- su id al sincronizar, y reenviarlo no lo duplica (se inserta solo si no existe).
-- Cada tabla guarda la hora del dispositivo (ocurrido_en / inicio) y la de llegada al servidor (recibido_en).

CREATE TABLE turno (
  id           UNIQUEIDENTIFIER PRIMARY KEY,
  sede_id      NVARCHAR(2) NOT NULL REFERENCES sede(id),
  usuario_id   INT NOT NULL REFERENCES usuario(id),
  recurso_id   INT NULL REFERENCES recurso(id),
  inicio       DATETIMEOFFSET(3) NOT NULL,
  fin          DATETIMEOFFSET(3) NULL,
  recibido_en  DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CHECK (fin IS NULL OR fin > inicio)
);

CREATE TABLE llamado (
  id                 UNIQUEIDENTIFIER PRIMARY KEY,
  sede_id            NVARCHAR(2) NOT NULL REFERENCES sede(id),
  bloque_id          INT NOT NULL REFERENCES punto(id),
  producto           NVARCHAR(20) NOT NULL DEFAULT 'flor' CHECK (producto IN ('flor', 'soca', 'esqueje')),
  cantidad_estimada  DECIMAL(8,1) NOT NULL DEFAULT 1 CHECK (cantidad_estimada > 0),
  creado_por         INT NOT NULL REFERENCES usuario(id),
  creado_en          DATETIMEOFFSET(3) NOT NULL,
  estado             NVARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'asignado', 'atendido', 'cancelado')),
  asignado_a         INT NULL REFERENCES usuario(id),
  asignado_en        DATETIMEOFFSET(3) NULL,
  recibido_en        DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE viaje (
  id                UNIQUEIDENTIFIER PRIMARY KEY,
  sede_id           NVARCHAR(2) NOT NULL REFERENCES sede(id),
  transportador_id  INT NOT NULL REFERENCES usuario(id),
  -- Quién creó el registro (el transportador o el anotador del bloque).
  creado_por        INT NOT NULL REFERENCES usuario(id),
  turno_id          UNIQUEIDENTIFIER NULL REFERENCES turno(id),
  recurso_id        INT NULL REFERENCES recurso(id),
  llamado_id        UNIQUEIDENTIFIER NULL REFERENCES llamado(id),
  origen_id         INT NOT NULL REFERENCES punto(id),
  destino_id        INT NOT NULL REFERENCES punto(id),
  producto          NVARCHAR(20) NOT NULL DEFAULT 'flor' CHECK (producto IN ('flor', 'soca', 'esqueje')),
  cantidad          DECIMAL(8,1) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  unidad            NVARCHAR(20) NOT NULL DEFAULT 'garrucha' CHECK (unidad IN ('garrucha', 'balde', 'bonche', 'tallo', 'canasta')),
  anulado           BIT NOT NULL DEFAULT 0,
  creado_en         DATETIMEOFFSET(3) NOT NULL,
  recibido_en       DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CHECK (origen_id <> destino_id)
);

-- Contenido de la garrucha: baldes por cuenta.
CREATE TABLE viaje_contenido (
  viaje_id  UNIQUEIDENTIFIER NOT NULL REFERENCES viaje(id) ON DELETE CASCADE,
  cuenta    NVARCHAR(40) NOT NULL REFERENCES cuenta(codigo),
  baldes    INT NOT NULL CHECK (baldes > 0),
  PRIMARY KEY (viaje_id, cuenta)
);

-- Secuencia de un viaje de cable vía:
-- llegada_bloque → salida_bloque → llegada_destino → fin_descargue → regreso
CREATE TABLE evento_viaje (
  id              UNIQUEIDENTIFIER PRIMARY KEY,
  viaje_id        UNIQUEIDENTIFIER NOT NULL REFERENCES viaje(id) ON DELETE CASCADE,
  tipo            NVARCHAR(20) NOT NULL CHECK (tipo IN ('llegada_bloque', 'salida_bloque', 'llegada_destino', 'fin_descargue', 'regreso')),
  ocurrido_en     DATETIMEOFFSET(3) NOT NULL,
  registrado_por  INT NOT NULL REFERENCES usuario(id),
  -- De dónde salió el evento: la app o una lectura importada de poscosecha.
  origen          NVARCHAR(20) NOT NULL DEFAULT 'app' CHECK (origen IN ('app', 'lectura_poscosecha')),
  recibido_en     DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT evento_viaje_tipo UNIQUE (viaje_id, tipo)
);

CREATE TABLE espera (
  id           UNIQUEIDENTIFIER PRIMARY KEY,
  sede_id      NVARCHAR(2) NOT NULL REFERENCES sede(id),
  usuario_id   INT NOT NULL REFERENCES usuario(id),
  viaje_id     UNIQUEIDENTIFIER NULL REFERENCES viaje(id),
  causa        NVARCHAR(40) NOT NULL REFERENCES causa_espera(codigo),
  inicio       DATETIMEOFFSET(3) NOT NULL,
  fin          DATETIMEOFFSET(3) NULL,
  recibido_en  DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CHECK (fin IS NULL OR fin >= inicio)
);

CREATE TABLE recibo (
  id            UNIQUEIDENTIFIER PRIMARY KEY,
  viaje_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT recibo_viaje UNIQUE REFERENCES viaje(id),
  recibido_por  INT NOT NULL REFERENCES usuario(id),
  ocurrido_en   DATETIMEOFFSET(3) NOT NULL,
  cantidad      DECIMAL(8,1) NOT NULL CHECK (cantidad >= 0),
  novedad       NVARCHAR(500) NULL,
  recibido_en   DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE falla (
  id             UNIQUEIDENTIFIER PRIMARY KEY,
  sede_id        NVARCHAR(2) NOT NULL REFERENCES sede(id),
  recurso_id     INT NULL REFERENCES recurso(id),
  punto_id       INT NULL REFERENCES punto(id),
  tipo           NVARCHAR(40) NOT NULL REFERENCES tipo_falla(codigo),
  descripcion    NVARCHAR(500) NULL,
  inicio         DATETIMEOFFSET(3) NOT NULL,
  fin            DATETIMEOFFSET(3) NULL,
  reportado_por  INT NOT NULL REFERENCES usuario(id),
  recibido_en    DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CHECK (fin IS NULL OR fin >= inicio)
);

-- Lecturas importadas del sistema de código de barras de poscosecha.
CREATE TABLE lectura_poscosecha (
  id                     INT IDENTITY PRIMARY KEY,
  sede_id                NVARCHAR(2) NOT NULL REFERENCES sede(id),
  codigo_transportador   NVARCHAR(40) NOT NULL,
  transportador_id       INT NULL REFERENCES usuario(id),
  baldes                 INT NOT NULL CHECK (baldes >= 0),
  ocurrido_en            DATETIMEOFFSET(3) NOT NULL,
  novedad                NVARCHAR(500) NULL,
  viaje_id               UNIQUEIDENTIFIER NULL REFERENCES viaje(id),
  archivo                NVARCHAR(200) NULL,
  importado_por          INT NOT NULL REFERENCES usuario(id),
  importado_en           DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT lectura_unica UNIQUE (sede_id, codigo_transportador, ocurrido_en)
);
CREATE UNIQUE INDEX lectura_viaje ON lectura_poscosecha (viaje_id) WHERE viaje_id IS NOT NULL;

CREATE INDEX viaje_sede_fecha   ON viaje (sede_id, creado_en);
CREATE INDEX llamado_pendiente  ON llamado (sede_id, estado, creado_en);
CREATE INDEX turno_sede_fecha   ON turno (sede_id, inicio);
CREATE INDEX espera_sede_fecha  ON espera (sede_id, inicio);
CREATE INDEX falla_sede_fecha   ON falla (sede_id, inicio);
CREATE INDEX lectura_sede_fecha ON lectura_poscosecha (sede_id, ocurrido_en);
