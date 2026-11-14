-- Datos FICTICIOS para desarrollo y pruebas. No representan la operación real.
-- Los maestros reales se cargan con scripts/importar_maestros.py (ver docs/despliegue.md).
-- PIN de todos los usuarios: 1234

INSERT INTO punto (sede_id, codigo, nombre, tipo) VALUES
  ('OL', 'POS1', 'Poscosecha Olas1', 'poscosecha'),
  ('OL', 'POS2', 'Poscosecha Olas2', 'poscosecha'),
  ('OL', 'B1', 'Bloque 1', 'bloque'),
  ('OL', 'B2', 'Bloque 2', 'bloque'),
  ('OL', 'B3', 'Bloque 3', 'bloque'),
  ('OL', 'B4', 'Bloque 4', 'bloque')
ON CONFLICT (sede_id, codigo) DO NOTHING;

-- Distancias ficticias, simétricas; ciclo = (ida + vuelta) / 55 + 10
INSERT INTO distancia (origen_id, destino_id, metros, ciclo_estandar_min)
SELECT o.id, d.id, m.metros, round(2 * m.metros / 55.0 + 10, 2)
FROM (VALUES ('B1','POS1',300), ('B2','POS1',420), ('B3','POS1',600), ('B4','POS1',750),
             ('B1','POS2',700), ('B2','POS2',560), ('B3','POS2',380), ('B4','POS2',250)) AS m(o, d, metros)
JOIN punto o ON o.sede_id = 'OL' AND o.codigo = m.o
JOIN punto d ON d.sede_id = 'OL' AND d.codigo = m.d
UNION ALL
SELECT d.id, o.id, m.metros, round(2 * m.metros / 55.0 + 10, 2)
FROM (VALUES ('B1','POS1',300), ('B2','POS1',420), ('B3','POS1',600), ('B4','POS1',750),
             ('B1','POS2',700), ('B2','POS2',560), ('B3','POS2',380), ('B4','POS2',250)) AS m(o, d, metros)
JOIN punto o ON o.sede_id = 'OL' AND o.codigo = m.o
JOIN punto d ON d.sede_id = 'OL' AND d.codigo = m.d
ON CONFLICT DO NOTHING;

INSERT INTO recurso (sede_id, codigo, tipo, capacidad, unidad) VALUES
  ('OL', 'G01', 'garrucha', 1, 'garrucha'),
  ('OL', 'G02', 'garrucha', 1, 'garrucha'),
  ('OL', 'G03', 'garrucha', 1, 'garrucha')
ON CONFLICT (sede_id, codigo) DO NOTHING;

INSERT INTO usuario (documento, nombre, rol, sede_id, pin_hash) VALUES
  ('100', 'Administrador demo',  'admin',         NULL, '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.'),
  ('101', 'Gerencia demo',       'gerencia',      NULL, '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.'),
  ('110', 'Jefe Olas demo',      'jefe_sede',     'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.'),
  ('111', 'Líder corte demo',    'lider_corte',   'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.'),
  ('112', 'Recibidor demo',      'recibidor',     'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.'),
  ('113', 'Transportador uno',   'transportador', 'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.'),
  ('114', 'Transportador dos',   'transportador', 'OL', '$2b$10$ikpkUN0ogGc003pacpd1iuGs/aMYabZq6RJ53GgQmlj.BUPpvEXE.')
ON CONFLICT (documento) DO NOTHING;

-- Piloto con anotador y lecturas de código de barras (cuentas ficticias)
UPDATE usuario SET codigo_barras = 'T113' WHERE documento = '113';
UPDATE usuario SET codigo_barras = 'T114' WHERE documento = '114';
INSERT INTO cuenta (codigo, nombre) VALUES
  ('C01', 'Cuenta demo 1'), ('C02', 'Cuenta demo 2'), ('C03', 'Cuenta demo 3')
ON CONFLICT (codigo) DO NOTHING;
