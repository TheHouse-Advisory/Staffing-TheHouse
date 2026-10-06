import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { PersonasClient } from "./PersonasClient";

export default async function PersonasPage() {
  // Exclusivo rol "personas": cualquier otro rol (incluido admin) es redirigido
  const authUser = await requireAuth();
  if (authUser.rol !== "personas") redirect("/tablero?error=sin_permisos");
  return <PersonasClient />;
}
