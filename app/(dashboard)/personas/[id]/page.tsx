import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { Topbar } from "@/components/layout/Topbar";
import { PersonaProfile } from "@/components/personas/PersonaProfile";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "Perfil Persona",
};

export default async function PersonaDetailPage({ params }: Props) {
  // Exclusivo rol "personas": cualquier otro rol (incluido admin) es redirigido
  const authUser = await requireAuth();
  if (authUser.rol !== "personas") redirect("/tablero?error=sin_permisos");
  const { id } = await params;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar titulo="Perfil" />
      <div className="flex-1 overflow-auto scrollbar-thin p-6">
        <PersonaProfile id={id} />
      </div>
    </div>
  );
}
