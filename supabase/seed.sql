-- ══════════════════════════════════════════════════════════════════════════════
-- seed.sql  —  Staffing Hub · Datos de prueba completos
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Crea datos coherentes para ejercitar TODAS las funcionalidades:
--   ✅ Tablero capacidad (ocupación por persona / por proyecto)
--   ✅ Vista Engagements (lista + detalle + cobertura)
--   ✅ Vista Planificación (Gantt, fit panel, propuesta)
--   ✅ Vista Ausencias (heatmap, todos los tipos de color)
--
-- ─── PERSONAS CREADAS (2 por cargo) ──────────────────────────────────────────
--   Gerentes         : Ana González, Carlos Martínez
--   Consultores Sr   : María Fernández, Diego López
--   Consultores      : Paula Ruiz, Sebastián Torres
--   Analistas Sr     : Fernanda Pizarro, Tomás Herrera
--   Analistas        : Valentina Castro, Matías Morales
--
-- ─── ENGAGEMENTS ─────────────────────────────────────────────────────────────
--   1. Transformación Digital  — Retail SA            (activo)    3 reqs
--   2. Eficiencia Operacional  — Minera Cobre SpA     (activo)    3 reqs
--   3. Estrategia Comercial    — Banco Central         (propuesta) 3 reqs
--   4. Reestructuración Org.   — Inmobiliaria Norte    (activo)    2 reqs
--
-- ─── COBERTURA (para ver alertas rojas en el tablero) ────────────────────────
--   Eng 1: Req Gerente 60% → Ana ✅ | Req Cons.Sr 80% → María ✅ | Req Consultor 100% → ❌
--   Eng 2: Req Gerente 40% → Carlos ✅ | Req Cons.Sr 100% → ❌ | Req Analista 80% → Valentina ✅
--   Eng 3: todos sin asignar ❌ (propuesta)
--   Eng 4: Req Cons.Sr 60% → ❌ | Req Consultor 80% → Sebastián ✅
--
-- ─── AUSENCIAS (para ver todos los colores del heatmap) ──────────────────────
--   Ana González     → dia_administrativo   07–08 Abr 2026
--   Carlos Martínez  → capacitacion         15–17 Abr 2026
--   María Fernández  → permiso              22 Abr 2026
--   Diego López      → vacaciones           21–30 Abr 2026
--   Paula Ruiz       → dia_libre            09 Abr 2026
--   Sebastián Torres → permiso              28–29 Abr 2026
--   Valentina Castro → licencia_medica      14–18 Abr 2026
--   Matías Morales   → otro                 23–24 Abr 2026
--   Fernanda Pizarro → vacaciones           01–10 Abr 2026
--   Tomás Herrera    → dia_libre            30 Abr 2026
--
-- PREREQUISITO: haber ejecutado reset.sql antes.
-- ⚠️  Ejecutar en Supabase SQL Editor (no en consola local)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
--  0a. Asegurar que historial no bloquee INSERTs
-- ─────────────────────────────────────────────────────────────
ALTER TABLE asignacion_historial DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
--  0b. Garantizar que config_cargo tenga todos los cargos
--      que usaremos (persona.cargo_actual y persona_cargo_historial.cargo
--      son FK a config_cargo.nombre).
--      presencia_minima_default debe estar entre 0 y 1 (es fracción, no %).
-- ─────────────────────────────────────────────────────────────
INSERT INTO config_cargo (nombre, excluido_capacidad, presencia_minima_default) VALUES
  ('Socio',            true,  0.50),
  ('Director',         false, 0.70),
  ('Gerente',          false, 0.75),
  ('Consultor Senior', false, 0.80),
  ('Consultor',        false, 0.80),
  ('Analista Senior',  false, 0.85),
  ('Analista',         false, 0.90),
  ('Practicante',      false, 0.95)
ON CONFLICT (nombre) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
--  1. PERSONAS
--     UUIDs fijos → referenciados en asignaciones y ausencias
-- ─────────────────────────────────────────────────────────────

-- rol_sistema = NULL porque estas personas no tienen auth_user_id en Supabase Auth.
-- El constraint "rol_requiere_auth" exige auth_user_id NOT NULL cuando rol_sistema != NULL.
INSERT INTO persona (id, nombre, apellido, email, cargo_actual, rol_sistema, activo, fecha_ingreso) VALUES
  -- Gerentes
  ('11111111-1111-1111-1111-000000000001', 'Ana',       'González',  'ana.gonzalez@thehouse.cl',       'Gerente',         NULL, true, '2020-03-01'),
  ('11111111-1111-1111-1111-000000000002', 'Carlos',    'Martínez',  'carlos.martinez@thehouse.cl',    'Gerente',         NULL, true, '2019-08-15'),
  -- Consultores Senior
  ('11111111-1111-1111-1111-000000000003', 'María',     'Fernández', 'maria.fernandez@thehouse.cl',    'Consultor Senior',NULL, true, '2021-01-10'),
  ('11111111-1111-1111-1111-000000000004', 'Diego',     'López',     'diego.lopez@thehouse.cl',        'Consultor Senior',NULL, true, '2022-04-20'),
  -- Consultores
  ('11111111-1111-1111-1111-000000000005', 'Paula',     'Ruiz',      'paula.ruiz@thehouse.cl',         'Consultor',       NULL, true, '2023-02-01'),
  ('11111111-1111-1111-1111-000000000006', 'Sebastián', 'Torres',    'sebastian.torres@thehouse.cl',   'Consultor',       NULL, true, '2023-06-15'),
  -- Analistas Senior
  ('11111111-1111-1111-1111-000000000007', 'Fernanda',  'Pizarro',   'fernanda.pizarro@thehouse.cl',   'Analista Senior', NULL, true, '2023-09-01'),
  ('11111111-1111-1111-1111-000000000008', 'Tomás',     'Herrera',   'tomas.herrera@thehouse.cl',      'Analista Senior', NULL, true, '2023-11-15'),
  -- Analistas
  ('11111111-1111-1111-1111-000000000009', 'Valentina', 'Castro',    'valentina.castro@thehouse.cl',   'Analista',        NULL, true, '2024-01-15'),
  ('11111111-1111-1111-1111-000000000010', 'Matías',    'Morales',   'matias.morales@thehouse.cl',     'Analista',        NULL, true, '2024-03-01')
ON CONFLICT (email) DO NOTHING;

-- Historial de cargo (evolución de carrera)
INSERT INTO persona_cargo_historial (persona_id, cargo, fecha_inicio, fecha_fin) VALUES
  ('11111111-1111-1111-1111-000000000001', 'Consultor Senior', '2020-03-01', '2022-01-31'),
  ('11111111-1111-1111-1111-000000000001', 'Gerente',          '2022-02-01', NULL),
  ('11111111-1111-1111-1111-000000000002', 'Consultor Senior', '2019-08-15', '2021-12-31'),
  ('11111111-1111-1111-1111-000000000002', 'Gerente',          '2022-01-01', NULL),
  ('11111111-1111-1111-1111-000000000003', 'Consultor',        '2021-01-10', '2023-06-30'),
  ('11111111-1111-1111-1111-000000000003', 'Consultor Senior', '2023-07-01', NULL),
  ('11111111-1111-1111-1111-000000000004', 'Consultor',        '2022-04-20', '2024-03-31'),
  ('11111111-1111-1111-1111-000000000004', 'Consultor Senior', '2024-04-01', NULL),
  ('11111111-1111-1111-1111-000000000007', 'Analista',         '2023-09-01', '2024-08-31'),
  ('11111111-1111-1111-1111-000000000007', 'Analista Senior',  '2024-09-01', NULL),
  ('11111111-1111-1111-1111-000000000008', 'Analista',         '2023-11-15', '2025-02-28'),
  ('11111111-1111-1111-1111-000000000008', 'Analista Senior',  '2025-03-01', NULL)
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────
--  2. ENGAGEMENTS
-- ─────────────────────────────────────────────────────────────

INSERT INTO engagement (id, nombre, cliente, tipo, estado, fecha_inicio, fecha_fin_estimada, descripcion, color) VALUES
  ('22222222-2222-2222-2222-000000000001',
   'Transformación Digital', 'Retail SA',
   'proyecto', 'activo',
   '2026-02-01', '2026-08-31',
   'Rediseño de procesos y digitalización de operaciones clave para la cadena retail.',
   '#4a90e2'),

  ('22222222-2222-2222-2222-000000000002',
   'Eficiencia Operacional', 'Minera Cobre SpA',
   'proyecto', 'activo',
   '2026-03-01', '2026-09-30',
   'Optimización de costos y mejora de rendimiento en planta de procesamiento.',
   '#27ae60'),

  ('22222222-2222-2222-2222-000000000003',
   'Estrategia Comercial', 'Banco Central de Chile',
   'propuesta', 'propuesta',
   '2026-05-01', '2026-10-31',
   'Diseño de estrategia go-to-market para nuevos segmentos de clientes corporativos.',
   '#e2844a'),

  ('22222222-2222-2222-2222-000000000004',
   'Reestructuración Organizacional', 'Inmobiliaria Norte',
   'proyecto', 'activo',
   '2026-01-15', '2026-06-30',
   'Rediseño de estructura organizacional y modernización de procesos de RRHH.',
   '#9b4ae2')

ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
--  3. REQUERIMIENTOS DE ENGAGEMENT
-- ─────────────────────────────────────────────────────────────

INSERT INTO requerimiento_engagement
  (id, engagement_id, fase_numero, fase_nombre, cargo_requerido, pct_dedicacion, fecha_inicio, fecha_fin, descripcion)
VALUES

  -- ── Engagement 1: Transformación Digital ──────────────────
  -- Req 1A: Gerente 60% → ASIGNADO a Ana González
  ('33333333-3333-3333-3333-000000000101',
   '22222222-2222-2222-2222-000000000001',
   1, 'Dirección y Gestión', 'Gerente', 60,
   '2026-02-01', '2026-08-31',
   'Liderar el proyecto, gestionar relación con cliente.'),

  -- Req 1B: Consultor Senior 80% → ASIGNADO a María Fernández
  ('33333333-3333-3333-3333-000000000102',
   '22222222-2222-2222-2222-000000000001',
   2, 'Análisis y Diseño', 'Consultor Senior', 80,
   '2026-02-01', '2026-07-31',
   'Análisis de procesos actuales y diseño de arquitectura futura.'),

  -- Req 1C: Consultor 100% → SIN ASIGNAR ⚠️
  ('33333333-3333-3333-3333-000000000103',
   '22222222-2222-2222-2222-000000000001',
   3, 'Implementación', 'Consultor', 100,
   '2026-04-01', '2026-08-31',
   'Implementación y puesta en marcha de los nuevos procesos digitales.'),

  -- ── Engagement 2: Eficiencia Operacional ──────────────────
  -- Req 2A: Gerente 40% → ASIGNADO a Carlos Martínez
  ('33333333-3333-3333-3333-000000000201',
   '22222222-2222-2222-2222-000000000002',
   1, 'Gestión de Proyecto', 'Gerente', 40,
   '2026-03-01', '2026-09-30',
   'Gestión del engagement y coordinación con cliente.'),

  -- Req 2B: Consultor Senior 100% → SIN ASIGNAR ⚠️
  ('33333333-3333-3333-3333-000000000202',
   '22222222-2222-2222-2222-000000000002',
   2, 'Diagnóstico', 'Consultor Senior', 100,
   '2026-03-01', '2026-06-30',
   'Diagnóstico de eficiencia y benchmarking del sector minero.'),

  -- Req 2C: Analista 80% → ASIGNADO a Valentina Castro
  ('33333333-3333-3333-3333-000000000203',
   '22222222-2222-2222-2222-000000000002',
   3, 'Modelamiento', 'Analista', 80,
   '2026-03-15', '2026-09-30',
   'Modelamiento de datos y análisis cuantitativo de costos operacionales.'),

  -- ── Engagement 3: Estrategia Comercial (todo sin asignar) ─
  ('33333333-3333-3333-3333-000000000301',
   '22222222-2222-2222-2222-000000000003',
   1, 'Dirección Estratégica', 'Gerente', 50,
   '2026-05-01', '2026-10-31',
   'Dirección estratégica y gestión ejecutiva del proyecto.'),

  ('33333333-3333-3333-3333-000000000302',
   '22222222-2222-2222-2222-000000000003',
   2, 'Estrategia y Diseño', 'Consultor Senior', 80,
   '2026-05-01', '2026-10-31',
   'Desarrollo del marco estratégico y formulación de recomendaciones.'),

  ('33333333-3333-3333-3333-000000000303',
   '22222222-2222-2222-2222-000000000003',
   3, 'Análisis de Mercado', 'Analista', 100,
   '2026-05-01', '2026-09-30',
   'Análisis de mercado, segmentación y benchmarking competitivo.'),

  -- ── Engagement 4: Reestructuración Organizacional ─────────
  -- Req 4A: Consultor Senior 60% → SIN ASIGNAR ⚠️
  ('33333333-3333-3333-3333-000000000401',
   '22222222-2222-2222-2222-000000000004',
   1, 'Diseño Organizacional', 'Consultor Senior', 60,
   '2026-01-15', '2026-06-30',
   'Diseño de nueva estructura organizacional y definición de roles.'),

  -- Req 4B: Consultor 80% → ASIGNADO a Sebastián Torres
  ('33333333-3333-3333-3333-000000000402',
   '22222222-2222-2222-2222-000000000004',
   2, 'Gestión del Cambio', 'Consultor', 80,
   '2026-03-01', '2026-06-30',
   'Implementación del cambio y gestión de la transformación cultural.')

ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
--  4. ASIGNACIONES CONFIRMADAS
--     Trigger escribe automáticamente en asignacion_historial.
-- ─────────────────────────────────────────────────────────────

INSERT INTO asignacion
  (id, persona_id, engagement_id, requerimiento_id, cargo_al_momento,
   pct_dedicacion, fecha_inicio, fecha_fin, estado)
VALUES

  -- Eng 1, Req 1A: Ana González → Gerente 60%
  (gen_random_uuid(),
   '11111111-1111-1111-1111-000000000001',
   '22222222-2222-2222-2222-000000000001',
   '33333333-3333-3333-3333-000000000101',
   'Gerente', 60, '2026-02-01', '2026-08-31', 'activa'),

  -- Eng 1, Req 1B: María Fernández → Consultor Senior 80%
  (gen_random_uuid(),
   '11111111-1111-1111-1111-000000000003',
   '22222222-2222-2222-2222-000000000001',
   '33333333-3333-3333-3333-000000000102',
   'Consultor Senior', 80, '2026-02-01', '2026-07-31', 'activa'),

  -- Eng 2, Req 2A: Carlos Martínez → Gerente 40%
  (gen_random_uuid(),
   '11111111-1111-1111-1111-000000000002',
   '22222222-2222-2222-2222-000000000002',
   '33333333-3333-3333-3333-000000000201',
   'Gerente', 40, '2026-03-01', '2026-09-30', 'activa'),

  -- Eng 2, Req 2C: Valentina Castro → Analista 80%
  (gen_random_uuid(),
   '11111111-1111-1111-1111-000000000009',
   '22222222-2222-2222-2222-000000000002',
   '33333333-3333-3333-3333-000000000203',
   'Analista', 80, '2026-03-15', '2026-09-30', 'activa'),

  -- Eng 4, Req 4B: Sebastián Torres → Consultor 80%
  (gen_random_uuid(),
   '11111111-1111-1111-1111-000000000006',
   '22222222-2222-2222-2222-000000000004',
   '33333333-3333-3333-3333-000000000402',
   'Consultor', 80, '2026-03-01', '2026-06-30', 'activa');


-- ─────────────────────────────────────────────────────────────
--  5. AUSENCIAS
--     ⚠️  PREREQUISITO: ejecutar add_ausencia_tipos.sql ANTES
--         para que el CHECK constraint acepte 'dia_libre' y
--         'dia_administrativo'. Si aún no lo has hecho, comenta
--         las filas que usan esos dos tipos.
--
--  La tabla NO tiene columna "aprobada" ni "auth_user_id".
--  Todas las ausencias ingresadas se consideran confirmadas.
--  Columnas: persona_id, tipo, fecha_inicio, fecha_fin,
--            dias_habiles, descripcion  (fuente = 'manual' default)
-- ─────────────────────────────────────────────────────────────
-- Tipo               Color heatmap     Persona
-- ─────────────────────────────────────────────────────────────
-- vacaciones         Azul  #3b82f6     Diego López, Fernanda Pizarro
-- dia_libre          Verde #22c55e     Paula Ruiz, Tomás Herrera
-- dia_administrativo Amber #f59e0b     Ana González
-- permiso            Lila  #a855f7     María Fernández, Sebastián Torres
-- licencia_medica    Rojo  #ef4444     Valentina Castro
-- capacitacion       Cyan  #06b6d4     Carlos Martínez
-- otro               Gris  #6b7280     Matías Morales

INSERT INTO ausencia
  (persona_id, tipo, fecha_inicio, fecha_fin, dias_habiles, descripcion)
VALUES

  -- Ana González: día administrativo 7–8 Abr
  ('11111111-1111-1111-1111-000000000001',
   'dia_administrativo', '2026-04-07', '2026-04-08', 2,
   'Trámites administrativos personales'),

  -- Carlos Martínez: capacitación 15–17 Abr
  ('11111111-1111-1111-1111-000000000002',
   'capacitacion', '2026-04-15', '2026-04-17', 3,
   'Workshop liderazgo ejecutivo'),

  -- María Fernández: permiso 22 Abr
  ('11111111-1111-1111-1111-000000000003',
   'permiso', '2026-04-22', '2026-04-22', 1,
   'Permiso personal'),

  -- Diego López: vacaciones 21–30 Abr
  ('11111111-1111-1111-1111-000000000004',
   'vacaciones', '2026-04-21', '2026-04-30', 8,
   'Vacaciones semana de feria'),

  -- Paula Ruiz: día libre post proyecto 9 Abr
  ('11111111-1111-1111-1111-000000000005',
   'dia_libre', '2026-04-09', '2026-04-09', 1,
   'Día libre por cierre de proyecto anterior'),

  -- Sebastián Torres: permiso 28–29 Abr
  ('11111111-1111-1111-1111-000000000006',
   'permiso', '2026-04-28', '2026-04-29', 2,
   'Permiso médico familiar'),

  -- Fernanda Pizarro: vacaciones 1–10 Abr
  ('11111111-1111-1111-1111-000000000007',
   'vacaciones', '2026-04-01', '2026-04-10', 8,
   'Vacaciones de verano'),

  -- Tomás Herrera: día libre 30 Abr
  ('11111111-1111-1111-1111-000000000008',
   'dia_libre', '2026-04-30', '2026-04-30', 1,
   'Día libre acumulado'),

  -- Valentina Castro: licencia médica 14–18 Abr
  ('11111111-1111-1111-1111-000000000009',
   'licencia_medica', '2026-04-14', '2026-04-18', 5,
   'Reposo médico post procedimiento'),

  -- Matías Morales: otro 23–24 Abr
  ('11111111-1111-1111-1111-000000000010',
   'otro', '2026-04-23', '2026-04-24', 2,
   'Ausencia no categorizada')

ON CONFLICT DO NOTHING;


COMMIT;


-- ─────────────────────────────────────────────────────────────
--  Verificación del seed
-- ─────────────────────────────────────────────────────────────
SELECT
  p.cargo_actual,
  p.nombre || ' ' || p.apellido AS persona,
  (SELECT COUNT(*) FROM asignacion a WHERE a.persona_id = p.id AND a.estado = 'activa') AS asignaciones,
  (SELECT COUNT(*) FROM ausencia au WHERE au.persona_id = p.id) AS ausencias
FROM persona p
WHERE p.email != 'sdelano@thehouse.cl'
ORDER BY
  CASE p.cargo_actual
    WHEN 'Gerente'          THEN 1
    WHEN 'Consultor Senior' THEN 2
    WHEN 'Consultor'        THEN 3
    WHEN 'Analista Senior'  THEN 4
    WHEN 'Analista'         THEN 5
    ELSE 6
  END,
  p.apellido;

SELECT
  e.nombre AS engagement,
  e.estado,
  COUNT(r.id) AS reqs_total,
  COUNT(a.id) AS reqs_cubiertos,
  COUNT(r.id) - COUNT(a.id) AS reqs_pendientes
FROM engagement e
LEFT JOIN requerimiento_engagement r ON r.engagement_id = e.id
LEFT JOIN asignacion a ON a.requerimiento_id = r.id AND a.estado = 'activa'
GROUP BY e.id, e.nombre, e.estado
ORDER BY e.nombre;

SELECT
  tipo,
  COUNT(*) AS cantidad,
  MIN(fecha_inicio) AS desde,
  MAX(fecha_fin) AS hasta
FROM ausencia
GROUP BY tipo
ORDER BY tipo;
-- Esperado: 7 tipos distintos, 10 ausencias en total
