-- Datos FICTICIOS para desarrollo y pruebas. No representan la operación real.
-- Los maestros reales se cargan con scripts/importar_maestros.py (ver docs/despliegue.md).
-- PIN de todos los usuarios: 1234

INSERT INTO punto (sede_id, codigo, nombre, tipo)
SELECT v.* FROM (VALUES
  ('OL', 'POS1', 'Poscosecha Olas1', 'poscosecha'),
  ('OL', 'POS2', 'Poscosecha Olas2', 'poscosecha'),
  ('OL', 'B1', 'Bloque 1', 'bloque'),
  ('OL', 'B2', 'Bloque 2', 'bloque'),
  ('OL', 'B3', 'Bloque 3', 'bloque'),
  ('OL', 'B4', 'Bloque 4', 'bloque')
) AS v (sede_id, codigo, nombre, tipo)
WHERE NOT EXISTS (SELECT 1 FROM punto p WHERE p.sede_id = v.sede_id AND p.codigo = v.codigo);

-- Distancias ficticias, simétricas; ciclo = (ida + vuelta) / 55 + 10
WITH m (o, d, metros) AS (
  SELECT * FROM (VALUES ('B1','POS1',300), ('B2','POS1',420), ('B3','POS1',600), ('B4','POS1',750),
                        ('B1','POS2',700), ('B2','POS2',560), ('B3','POS2',380), ('B4','POS2',250)) AS t (o, d, metros)
), pares AS (
  SELECT o.id AS origen_id, d.id AS destino_id, m.metros FROM m
  JOIN punto o ON o.sede_id = 'OL' AND o.codigo = m.o
  JOIN punto d ON d.sede_id = 'OL' AND d.codigo = m.d
  UNION ALL
  SELECT d.id, o.id, m.metros FROM m
  JOIN punto o ON o.sede_id = 'OL' AND o.codigo = m.o
  JOIN punto d ON d.sede_id = 'OL' AND d.codigo = m.d
)
INSERT INTO distancia (origen_id, destino_id, metros, ciclo_estandar_min)
SELECT p.origen_id, p.destino_id, p.metros, ROUND(2 * p.metros / 55.0 + 10, 2)
FROM pares p
WHERE NOT EXISTS (SELECT 1 FROM distancia x WHERE x.origen_id = p.origen_id AND x.destino_id = p.destino_id);

INSERT INTO recurso (sede_id, codigo, tipo, capacidad, unidad)
SELECT v.* FROM (VALUES
  ('OL', 'G01', 'garrucha', 1, 'garrucha'),
  ('OL', 'G02', 'garrucha', 1, 'garrucha'),
  ('OL', 'G03', 'garrucha', 1, 'garrucha')
) AS v (sede_id, codigo, tipo, capacidad, unidad)
WHERE NOT EXISTS (SELECT 1 FROM recurso r WHERE r.sede_id = v.sede_id AND r.codigo = v.codigo);

INSERT INTO usuario (documento, nombre, rol, sede_id, pin_hash, codigo_barras)
SELECT v.* FROM (VALUES
  ('100', N'Administrador demo',  'admin',         NULL, '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.', NULL),
  ('101', N'Gerencia demo',       'gerencia',      NULL, '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.', NULL),
  ('110', N'Jefe Olas demo',      'jefe_sede',     'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.', NULL),
  ('111', N'Líder corte demo',    'lider_corte',   'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.', NULL),
  ('112', N'Recibidor demo',      'recibidor',     'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.', NULL),
  ('113', N'Transportador uno',   'transportador', 'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.', 'T113'),
  ('114', N'Transportador dos',   'transportador', 'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.', 'T114')
) AS v (documento, nombre, rol, sede_id, pin_hash, codigo_barras)
WHERE NOT EXISTS (SELECT 1 FROM usuario u WHERE u.documento = v.documento);

-- Cuentas ficticias
INSERT INTO cuenta (codigo, nombre)
SELECT v.* FROM (VALUES ('C01', 'Cuenta demo 1'), ('C02', 'Cuenta demo 2'), ('C03', 'Cuenta demo 3')) AS v (codigo, nombre)
WHERE NOT EXISTS (SELECT 1 FROM cuenta c WHERE c.codigo = v.codigo);
