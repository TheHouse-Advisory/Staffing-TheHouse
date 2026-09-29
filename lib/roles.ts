/**
 * Helpers de roles (seguros para cliente y servidor).
 * 'personas' tiene hoy los mismos permisos que 'admin'.
 * Si admin se restringe, ajustar los chequeos puntuales, no ROLES_ADMIN.
 */
import type { RolSistema } from "@/lib/types/database";

/** Roles con permisos de administrador. */
export const ROLES_ADMIN: RolSistema[] = ["admin", "personas"];

export function esAdmin(rol: RolSistema | string | null | undefined): boolean {
  return ROLES_ADMIN.includes(rol as RolSistema);
}
