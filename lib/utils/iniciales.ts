/**
 * Retorna las iniciales de una persona para mostrar en avatares.
 * Si tiene iniciales personalizadas (`custom`), las usa (máx. 3 caracteres).
 * Si no, calcula las automáticas desde el primer carácter de nombre y apellido.
 */
export function getIniciales(
  nombre: string,
  apellido: string,
  custom?: string | null
): string {
  if (custom && custom.trim()) return custom.trim().toUpperCase().slice(0, 3);
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}
