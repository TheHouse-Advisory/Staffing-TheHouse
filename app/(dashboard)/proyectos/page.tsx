"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { EngagementsList } from "@/components/engagements/EngagementsList";
import { createClient, createAnyClient } from "@/lib/supabase/client";
import type { RolSistema } from "@/lib/types/database";

export default function ProyectosPage() {
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
      <Topbar
        titulo="Proyectos"
        actions={
          <Link
            href="/proyectos/nuevo"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a4e] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo proyecto
          </Link>
        }
      />
      <div className="flex-1 overflow-auto scrollbar-thin p-6">
        <EngagementsList rolActual={rol} />
      </div>
    </div>
  );
}
