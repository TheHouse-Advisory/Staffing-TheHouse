"use client";

import { useState, useEffect } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { PersonasList } from "@/components/personas/PersonasList";
import { createClient, createAnyClient } from "@/lib/supabase/client";
import type { RolSistema } from "@/lib/types/database";

export default function PersonasPage() {
  const [rol, setRol] = useState<RolSistema | null>(null);

  useEffect(() => {
    async function loadRol() {
      const supabase = createClient();
      const sb = createAnyClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await sb
        .from("persona")
        .select("rol_sistema")
        .eq("auth_user_id", user.id)
        .single();
      setRol((data?.rol_sistema as RolSistema) ?? null);
    }
    loadRol();
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar titulo="Personas" />
      <div className="flex-1 overflow-auto scrollbar-thin p-6">
        <PersonasList rolActual={rol} />
      </div>
    </div>
  );
}
