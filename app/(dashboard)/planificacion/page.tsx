import { requireAuth } from "@/lib/auth";
import { PlanificacionDesactivada } from "@/components/planificacion/PlanificacionDesactivada";

/**
 * Planificación está DESACTIVADA temporalmente: tiene fallas sin resolver (aprobar escenario
 * puede borrar asignaciones de toda la empresa, entre otras) y no está en uso.
 * La herramienta (components/planificacion/GanttPlanificacion.tsx) no se carga: quien entre,
 * incluso por enlace directo, solo ve el aviso bloqueante.
 * Para reactivarla, volver a renderizar <GanttPlanificacion /> aquí una vez corregida.
 */
export default async function PlanificacionPage() {
  await requireAuth();
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <div>
          <h1 className="text-[16px] font-bold text-[#1a1a1a] leading-tight">Planificación</h1>
          <p className="text-[11px] text-[#888] leading-tight">Desactivada temporalmente</p>
        </div>
      </header>
      <PlanificacionDesactivada />
    </div>
  );
}
