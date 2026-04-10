import { GanttPlanificacion } from "@/components/planificacion/GanttPlanificacion";

export default function PlanificacionPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <div>
          <h1 className="text-[16px] font-bold text-[#1a1a1a] leading-tight">Planificación</h1>
          <p className="text-[11px] text-[#888] leading-tight">
            Asigna personas a requerimientos · Verifica fit y capacidad · Genera propuestas
          </p>
        </div>
      </header>

      {/* Vista principal */}
      <div className="flex-1 overflow-hidden">
        <GanttPlanificacion />
      </div>
    </div>
  );
}
