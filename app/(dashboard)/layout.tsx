"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { createClient } from "@/lib/supabase/client";
import type { Persona, RolSistema } from "@/lib/types/database";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const [persona, setPersona] = useState<Persona | null>(null);

  const loadUser = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data } = await supabase
      .from("persona")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (data) setPersona(data);
  }, [router]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

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
      />
      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  );
}
