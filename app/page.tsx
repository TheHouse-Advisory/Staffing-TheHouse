import { redirect } from "next/navigation";

/**
 * Raíz del sitio — redirige siempre al tablero.
 * El middleware se encarga de redirigir a /login si no hay sesión.
 */
export default function HomePage() {
  redirect("/tablero");
}
