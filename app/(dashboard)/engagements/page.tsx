"use client";

import { useState, useEffect } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { EngagementsList } from "@/components/engagements/EngagementsList";
import { createClient } from "@/lib/supabase/client";
import type { RolSistema } from "@/lib/types/database";

export default function EngagementsPage() {
  const [rol, setRol] = useState<RolSistema | null>(null);

  useEffect(() => {
    async function loadRol() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
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
      <Topbar titulo="Engagements" />
      <div className="flex-1 overflow-auto scrollbar-thin p-6">
        <EngagementsList rolActual={rol} />
      </div>
    </div>
  );
}
