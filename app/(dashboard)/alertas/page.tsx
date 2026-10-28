import { requireAuth } from "@/lib/auth";
import { AlertasPanel } from "@/components/alertas/AlertasPanel";
import { RecordatorioFeriados } from "@/components/alertas/RecordatorioFeriados";

export default async function AlertasPage() {
  const { persona, rol } = await requireAuth();
  // El recordatorio de feriados es solo para quienes administran el calendario
  const veSoporte = rol === "admin" || rol === "personas";
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#1a1a2e]">Alertas</h1>
          <p className="text-sm text-gray-400 mt-0.5">Recordatorios y notificaciones del equipo</p>
        </div>
        {veSoporte && <RecordatorioFeriados />}
        <AlertasPanel personaId={persona.id} />
      </div>
    </div>
  );
}
