-- ════════════════════════════════════════════════════════════════════════
--  Índices de rendimiento.
--
--  Las consultas del tablero, inicio, planificación y capacity filtran y
--  cruzan tablas por columnas que Postgres NO indexa automáticamente
--  (las claves foráneas no se indexan solas). Sin estos índices, cada
--  consulta hace un sequential scan: imperceptible con pocos datos, lento
--  a medida que crecen asignaciones, engagements y ausencias.
--
--  Todos usan IF NOT EXISTS → es seguro re-ejecutar la migración.
--
--  ⚠️  Antes de correr, revisa los índices existentes:
--
--    SELECT tablename, indexname, indexdef
--    FROM pg_indexes
--    WHERE schemaname = 'public'
--    ORDER BY tablename, indexname;
--
--  Si ya existe un índice que cubre las MISMAS columnas con otro nombre,
--  borra esa línea de abajo para no crear un índice duplicado.
--
--  Ejecutar en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════════

-- ── asignacion ──────────────────────────────────────────────────────────
-- Se filtra por estado + rango de fechas y se cruza por las 3 FK.
CREATE INDEX IF NOT EXISTS idx_asignacion_estado
  ON asignacion (estado);
CREATE INDEX IF NOT EXISTS idx_asignacion_persona
  ON asignacion (persona_id);
CREATE INDEX IF NOT EXISTS idx_asignacion_engagement
  ON asignacion (engagement_id);
CREATE INDEX IF NOT EXISTS idx_asignacion_requerimiento
  ON asignacion (requerimiento_id);
CREATE INDEX IF NOT EXISTS idx_asignacion_fechas
  ON asignacion (fecha_inicio, fecha_fin);

-- ── requerimiento_engagement ────────────────────────────────────────────
-- Se cruza por engagement_id y se filtra por rango de fechas.
CREATE INDEX IF NOT EXISTS idx_req_engagement
  ON requerimiento_engagement (engagement_id);
CREATE INDEX IF NOT EXISTS idx_req_fechas
  ON requerimiento_engagement (fecha_inicio, fecha_fin);

-- ── engagement ──────────────────────────────────────────────────────────
-- El tablero filtra siempre por estado e is_deleted.
CREATE INDEX IF NOT EXISTS idx_engagement_estado
  ON engagement (estado);
CREATE INDEX IF NOT EXISTS idx_engagement_is_deleted
  ON engagement (is_deleted);

-- ── persona ─────────────────────────────────────────────────────────────
-- auth_user_id: lookup en cada carga de página (layout, requireAuth).
-- activo: filtro en casi todas las listas de personas.
CREATE INDEX IF NOT EXISTS idx_persona_auth_user
  ON persona (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_persona_activo
  ON persona (activo);

-- ── ausencia ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ausencia_persona
  ON ausencia (persona_id);
CREATE INDEX IF NOT EXISTS idx_ausencia_fechas
  ON ausencia (fecha_inicio, fecha_fin);

-- ── capacity_planning ───────────────────────────────────────────────────
-- Existe un unique (persona_id, semana_inicio); este índice acelera el
-- filtro por rango de semanas que hace fetchCapacityData.
CREATE INDEX IF NOT EXISTS idx_capacity_semana
  ON capacity_planning (semana_inicio);

-- ── dia_critico ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dia_critico_eng_fecha
  ON dia_critico (engagement_id, fecha);

-- ── asignacion_propuesta ────────────────────────────────────────────────
-- Se filtra por plan_id + estado al cargar un plan en el tablero.
CREATE INDEX IF NOT EXISTS idx_asig_prop_plan
  ON asignacion_propuesta (plan_id);
