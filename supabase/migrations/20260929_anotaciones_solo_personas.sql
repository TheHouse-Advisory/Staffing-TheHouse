-- Anotaciones: acceso exclusivo para rol 'personas' (admin ya no puede ver ni editar).
-- fn_is_admin_rol() solo la usan las políticas de anotacion y sus carpetas.
CREATE OR REPLACE FUNCTION fn_is_admin_rol()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema = 'personas'
  );
$$;
