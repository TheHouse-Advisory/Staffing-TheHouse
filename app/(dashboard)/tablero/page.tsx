"use client";

import { useState, useEffect } from "react";
import { startOfISOWeek, addWeeks, subWeeks, format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { TablonOcupacion } from "@/components/tablero/TablonOcupacion";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface PlanResumen {
  id: string;
  nombre: string;
}

export default function TableroPage() {
  const [semanaInicio, setSemanaInicio] = useState<Date>(() =>
    startOfISOWeek(new Date())
  );
  // null = vista real; string = ID del plan
  const [planId, setPlanId] = useState<string | null>(null);
  const [planes, setPlanes] = useState<PlanResumen[]>([]);
  const [planesLoading, setPlanesLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const semanaLabel = (() => {
    const fin = addWeeks(semanaInicio, 6);
    return `${format(semanaInicio, "d MMM", { locale: es })} – ${format(fin, "d MMM yyyy", { locale: es })}`;
  })();

  // Cargar planes borrador para el selector
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("propuesta_plan")
      .select("id, nombre")
      .eq("estado", "borrador")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setPlanes((data ?? []) as PlanResumen[]);
        setPlanesLoading(false);
      });
  }, []);

  const planActual = planes.find((p) => p.id === planId);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Topbar del tablero */}
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-4 flex-shrink-0">
        <h1 className="text-[16px] font-bold flex-1">Tablero de Capacidad</h1>

        {/* Navegación de semana */}
        <div className="flex items-center gap-2 text-[13px] text-[#555]">
          <button
            onClick={() => setSemanaInicio((s) => subWeeks(s, 1))}
            className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
            title="Semana anterior"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="font-semibold text-[#1a1a1a] min-w-[220px] text-center">
            {semanaLabel}
          </span>
          <button
            onClick={() => setSemanaInicio((s) => addWeeks(s, 1))}
            className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
            title="Semana siguiente"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setSemanaInicio(startOfISOWeek(new Date()))}
            className="ml-1 text-xs px-2.5 py-1 rounded-md border border-[#e0e0e0] hover:bg-[#f5f5f5] transition-colors text-[#555]"
          >
            Hoy
          </button>
        </div>

        {/* Selector de vista: Real vs Plan */}
        <div className="flex bg-[#f0f0f0] rounded-lg p-[3px] gap-[2px] relative">
          {/* Botón Real */}
          <button
            onClick={() => { setPlanId(null); setDropdownOpen(false); }}
            className={cn(
              "px-3.5 py-[5px] rounded-md text-xs font-semibold transition-all",
              planId === null
                ? "bg-white text-[#1a1a1a] shadow-sm"
                : "text-[#888] hover:text-[#555]"
            )}
          >
            Real
          </button>

          {/* Botón Plan (dropdown) */}
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-[5px] rounded-md text-xs font-semibold transition-all",
              planId !== null
                ? "bg-[#eaf4ff] text-[#1a5276] shadow-sm"
                : "text-[#888] hover:text-[#555]"
            )}
          >
            {planId && planActual ? planActual.nombre : "Plan"}
            <ChevronDown className="w-3 h-3" />
          </button>

          {/* Dropdown de planes */}
          {dropdownOpen && (
            <div className="absolute top-full right-0 mt-1.5 min-w-[220px] bg-white border border-[#e8e8e8] rounded-xl shadow-lg z-20 overflow-hidden">
              {planesLoading ? (
                <p className="text-xs text-[#888] px-4 py-3">Cargando planes...</p>
              ) : planes.length === 0 ? (
                <p className="text-xs text-[#888] px-4 py-3">
                  No hay planes en borrador. Crea uno desde Propuestas.
                </p>
              ) : (
                <div className="py-1.5">
                  {planes.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => { setPlanId(plan.id); setDropdownOpen(false); }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 text-sm transition-colors",
                        planId === plan.id
                          ? "bg-[#eaf4ff] text-[#1a5276] font-semibold"
                          : "text-[#333] hover:bg-[#f5f5f5]"
                      )}
                    >
                      {plan.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Click fuera cierra el dropdown */}
      {dropdownOpen && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setDropdownOpen(false)}
        />
      )}

      {/* Contenido */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        <TablonOcupacion semanaInicio={semanaInicio} planId={planId} />
      </div>
    </div>
  );
}
