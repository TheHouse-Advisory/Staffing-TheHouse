"use client";

import { useEffect, useState } from "react";
import { BarChart2, Grid2X2, Layers } from "lucide-react";
import { ReportCard } from "@/components/reportes/ReportCard";
import { TalentMatrixPreview } from "@/components/reportes/TalentMatrixPreview";
import { createClient, createAnyClient } from "@/lib/supabase/client";
import type { RolSistema } from "@/lib/types/database";

const REPORTES = [
  {
    id: "matriz-talento",
    titulo: "Matriz de Talento",
    categoria: "Recursos Humanos",
    icon: Grid2X2,
    iconColor: "#7c5cbf",
    iconBg: "bg-[#f3f0ff]",
    href: "/reportes/matriz-talento",
    // GyD no puede ver este reporte
    allowedRoles: ["admin"] as RolSistema[],
  },
  {
    id: "resumen-proyectos",
    titulo: "Resumen de Proyectos",
    categoria: "Proyectos",
    icon: BarChart2,
    iconColor: "#4a90e2",
    iconBg: "bg-[#f0f6ff]",
    href: "/reportes/resumen-proyectos",
  },
  {
    id: "capacity-proyectos",
    titulo: "Capacity de Proyectos",
    categoria: "Recursos",
    icon: Layers,
    iconColor: "#0ea5e9",
    iconBg: "bg-[#f0fbff]",
    href: "/reportes/capacity-proyectos",
  },
];

export default function ReportesPage() {
  const [rol, setRol] = useState<RolSistema | null>(null);

  useEffect(() => {
    async function loadRol() {
      const supabase = createClient();
      const sb = createAnyClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await sb.from("persona").select("rol_sistema").eq("auth_user_id", user.id).single();
      setRol((data?.rol_sistema as RolSistema) ?? null);
    }
    loadRol();
  }, []);

  const reportesVisibles = REPORTES.filter(
    (r) => !r.allowedRoles || r.allowedRoles.includes(rol as RolSistema)
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <BarChart2 className="w-4 h-4 text-[#4a90e2]" />
        <h1 className="text-[16px] font-bold flex-1 text-[#1a1a2e]">Reportes</h1>
        <span className="text-[11px] text-gray-400 font-medium">
          {reportesVisibles.length} {reportesVisibles.length === 1 ? "módulo disponible" : "módulos disponibles"}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 max-w-4xl">
          {reportesVisibles.map((r) => (
            <ReportCard
              key={r.id}
              icon={r.icon}
              iconColor={r.iconColor}
              iconBg={r.iconBg}
              titulo={r.titulo}
              categoria={r.categoria}
              href={r.href}
              preview={r.id === "matriz-talento" ? <TalentMatrixPreview /> : undefined}
              previewClassName={r.id === "matriz-talento" ? "h-[220px]" : "h-40"}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
