import { BarChart2, Grid2X2, Layers } from "lucide-react";
import { ReportCard } from "@/components/reportes/ReportCard";
import { TalentMatrixPreview } from "@/components/reportes/TalentMatrixPreview";

// ── Catálogo de reportes disponibles ────────────────────────────
// Para agregar un nuevo reporte basta añadir un objeto a este array.
const REPORTES = [
  {
    id: "matriz-talento",
    titulo: "Matriz de Talento",
    categoria: "Recursos Humanos",
    icon: Grid2X2,
    iconColor: "#7c5cbf",
    iconBg: "bg-[#f3f0ff]",
    href: "/reportes/matriz-talento",
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
] as const;

export default function ReportesPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <BarChart2 className="w-4 h-4 text-[#4a90e2]" />
        <h1 className="text-[16px] font-bold flex-1 text-[#1a1a2e]">Reportes</h1>
        <span className="text-[11px] text-gray-400 font-medium">
          {REPORTES.length} {REPORTES.length === 1 ? "módulo disponible" : "módulos disponibles"}
        </span>
      </header>

      {/* ── Grid de reportes ───────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 max-w-4xl">
          {REPORTES.map((r) => (
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
