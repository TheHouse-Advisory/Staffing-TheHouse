import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";

/**
 * Raíz del sitio — redirige según rol.
 * AySr/GyD/Desarrollo entran por defecto a Inicio; el resto, al Tablero.
 * El middleware se encarga de redirigir a /login si no hay sesión.
 */
export default async function HomePage() {
  const { rol } = await requireAuth();
  if (rol === "AySr" || rol === "GyD" || rol === "Desarrollo") {
    redirect("/inicio");
  }
  redirect("/tablero");
}
