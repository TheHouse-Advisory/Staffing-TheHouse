"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface DescargableCardProps {
  titulo: string;
  descripcion: string;
  botonLabel: string;
  loading: boolean;
  onDescargar: () => void;
}

function DescargableCard({ titulo, descripcion, botonLabel, loading, onDescargar }: DescargableCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 flex items-center justify-between gap-4 max-w-2xl shadow-sm">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#f0fdf4] flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="w-5 h-5 text-[#16a34a]" />
        </div>
        <div>
          <p className="font-bold text-[14px] text-[#1a1a2e] leading-tight">{titulo}</p>
          <p className="text-[11px] text-slate-400">{descripcion}</p>
        </div>
      </div>
      <Button variant="secondary" onClick={onDescargar} disabled={loading}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {loading ? "Generando..." : botonLabel}
      </Button>
    </div>
  );
}

export function DescargablesClient() {
  const anio = new Date().getFullYear();
  const [loadingPersonas, setLoadingPersonas] = useState(false);
  const [loadingStaffing, setLoadingStaffing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar(url: string, filename: string, setLoading: (v: boolean) => void) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Error ${res.status}`);
      }
      descargarBlob(await res.blob(), filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar el Excel");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <Download className="w-4 h-4 text-[#4a90e2]" />
        <h1 className="text-[16px] font-bold flex-1 text-[#1a1a2e]">Descargables de Resguardo</h1>
      </header>

      {error && (
        <div className="px-6 py-2 text-[12px] text-red-600 bg-red-50 border-b border-red-100 flex-shrink-0">
          Error al descargar: {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        <DescargableCard
          titulo={`Info personas ${anio}`}
          descripcion="Respaldo consolidado de información de personas"
          botonLabel="Descargar Info personas"
          loading={loadingPersonas}
          onDescargar={() =>
            descargar("/api/reportes/personas-resguardo-excel", "Info personas.xlsx", setLoadingPersonas)
          }
        />
        <DescargableCard
          titulo={`Respaldo Staffing ${anio}`}
          descripcion="Resguardo y desglose de engagements, asignaciones y proyectos"
          botonLabel="Descargar Respaldo Staffing"
          loading={loadingStaffing}
          onDescargar={() =>
            descargar("/api/reportes/resumen-proyectos-excel", `Respaldo Staffing ${anio}.xlsx`, setLoadingStaffing)
          }
        />
      </div>
    </div>
  );
}
