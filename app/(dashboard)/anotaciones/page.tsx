import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { AnotacionesList } from "@/components/anotaciones/AnotacionesList";

export default async function AnotacionesPage() {
  // Solo rol 'personas' (admin excluido)
  const { rol } = await requireAuth();
  if (rol !== "personas") redirect("/tablero?error=sin_permisos");

  return <AnotacionesList />;
}
