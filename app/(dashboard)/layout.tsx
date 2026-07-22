"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { CargosColapsadosProvider } from "@/components/providers/CargosColapsadosContext";
import { createClient, createAnyClient } from "@/lib/supabase/client";
import type { Persona, RolSistema } from "@/lib/types/database";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const loadUser = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const sb = createAnyClient();
    const { data } = await sb
      .from("persona")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (data) {
      // El acceso pudo ser revocado o suspendido por un admin → cerrar sesión.
      if (!data.rol_sistema || data.acceso_estado === "suspendida") {
        await supabase.auth.signOut();
        router.replace(
          `/login?error=${
            data.acceso_estado === "suspendida" ? "acceso_suspendido" : "sin_acceso"
          }`
        );
        return;
      }
      setPersona(data);
    }
  }, [router]);

  // Re-fetch en cada cambio de ruta para que el rol siempre esté fresco
  useEffect(() => {
    loadUser();
  }, [loadUser, pathname]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        nombreCompleto={
          persona ? `${persona.nombre} ${persona.apellido}` : "..."
        }
        cargo={persona?.cargo_actual ?? null}
        rol={persona?.rol_sistema as RolSistema | null}
        onSignOut={handleSignOut}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
      />
      <main className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${isCollapsed ? "layout-zoom" : ""}`}>
        <CargosColapsadosProvider>{children}</CargosColapsadosProvider>
      </main>
      <CommandPalette />
    </div>
  );
}
