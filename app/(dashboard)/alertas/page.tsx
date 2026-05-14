import { AlertasPanel } from "@/components/alertas/AlertasPanel";

export default function AlertasPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#1a1a2e]">Alertas</h1>
          <p className="text-sm text-gray-400 mt-0.5">Recordatorios y notificaciones del equipo</p>
        </div>
        <AlertasPanel />
      </div>
    </div>
  );
}
