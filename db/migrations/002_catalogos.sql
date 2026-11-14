-- Sedes y catálogos comunes. Los parámetros de Olas vienen del estudio de capacidad (nov. 2025);
-- los de Manantiales y Caribe son supuestos hasta medirlos (ver docs/piloto.md).

INSERT INTO sede (id, nombre, medio, inicio_jornada, horas_jornada, min_cargue_estandar, min_descargue_estandar, velocidad_m_min) VALUES
  ('OL', 'Olas',        'cable_via', '06:15', 7, 5, 5, 55),
  ('MT', 'Manantiales', 'cable_via', '06:15', 7, 5, 5, 55),
  ('FE', 'Caribe',      'tractor',   '06:15', 7, 10, 10, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO causa_espera (codigo, nombre, orden) VALUES
  ('flor_no_lista',   'Flor no lista',          1),
  ('cola_recibo',     'Cola en recibo',         2),
  ('encuentro_via',   'Encuentro en la vía',    3),
  ('cambio_agua',     'Cambio de agua',         4),
  ('falla_equipo',    'Falla del equipo',       5),
  ('pausa',           'Pausa personal',         6),
  ('otra',            'Otra',                   9)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO tipo_falla (codigo, nombre, medio, orden) VALUES
  ('cable_danado',     'Cable dañado',          'cable_via', 1),
  ('garrucha_danada',  'Garrucha dañada',       'cable_via', 2),
  ('tramo_bloqueado',  'Tramo bloqueado',       'cable_via', 3),
  ('falla_mecanica',   'Falla mecánica',        'tractor',   1),
  ('combustible',      'Sin combustible',       'tractor',   2),
  ('via_mal_estado',   'Vía en mal estado',     'tractor',   3),
  ('otra',             'Otra',                  NULL,        9)
ON CONFLICT (codigo) DO NOTHING;
