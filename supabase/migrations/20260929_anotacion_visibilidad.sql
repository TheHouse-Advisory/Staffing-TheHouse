-- ──────────────────────────────────────────────────────────────────────────────
-- Anotaciones privadas / compartidas.
--  - es_privada = false (default) → la ven todos los de rol 'personas'.
--  - es_privada = true            → solo la ve su autor.
--  - Editar/eliminar: solo el autor. Notas antiguas sin autor (autor_id NULL)
--    siguen editables por todos los de rol 'personas'.
--  - autor_id lo fija el servidor (trigger), no el cliente.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE anotacion ADD COLUMN IF NOT EXISTS es_privada boolean NOT NULL DEFAULT false;

-- Una nota privada debe tener dueño (si no, nadie podría verla).
ALTER TABLE anotacion DROP CONSTRAINT IF EXISTS anotacion_privada_con_autor;
ALTER TABLE anotacion
  ADD CONSTRAINT anotacion_privada_con_autor CHECK (NOT es_privada OR autor_id IS NOT NULL);

-- persona.id del usuario autenticado
CREATE OR REPLACE FUNCTION fn_persona_actual_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id FROM persona WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- autor_id: se asigna al crear y no se puede cambiar después
CREATE OR REPLACE FUNCTION anotacion_fijar_autor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service_role / SQL Editor
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.autor_id := fn_persona_actual_id();
  ELSE
    NEW.autor_id := OLD.autor_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_anotacion_fijar_autor ON anotacion;
CREATE TRIGGER trg_anotacion_fijar_autor
  BEFORE INSERT OR UPDATE ON anotacion
  FOR EACH ROW EXECUTE FUNCTION anotacion_fijar_autor();

-- ── Políticas RLS ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anotacion: lectura admin" ON anotacion;
DROP POLICY IF EXISTS "anotacion: lectura" ON anotacion;
CREATE POLICY "anotacion: lectura" ON anotacion
  FOR SELECT USING (
    fn_is_admin_rol() AND (NOT es_privada OR autor_id = fn_persona_actual_id())
  );

-- Crear: se mantiene "anotacion: crear admin" (fn_is_admin_rol()).

DROP POLICY IF EXISTS "anotacion: editar admin" ON anotacion;
DROP POLICY IF EXISTS "anotacion: editar autor" ON anotacion;
CREATE POLICY "anotacion: editar autor" ON anotacion
  FOR UPDATE
  USING (fn_is_admin_rol() AND (autor_id IS NULL OR autor_id = fn_persona_actual_id()))
  WITH CHECK (fn_is_admin_rol() AND (autor_id IS NULL OR autor_id = fn_persona_actual_id()));

DROP POLICY IF EXISTS "anotacion: eliminar admin" ON anotacion;
DROP POLICY IF EXISTS "anotacion: eliminar autor" ON anotacion;
CREATE POLICY "anotacion: eliminar autor" ON anotacion
  FOR DELETE
  USING (fn_is_admin_rol() AND (autor_id IS NULL OR autor_id = fn_persona_actual_id()));
