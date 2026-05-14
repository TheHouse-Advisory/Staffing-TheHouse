"use client";

import { useState } from "react";
import { startOfISOWeek, addWeeks, subWeeks, addMonths, subMonths, addDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DesgloceEngagements } from "@/components/inicio/DesgloceEngagements";
import { PerfilIndividualTablero } from "@/components/inicio/PerfilIndividualTablero";
import { cn } from "@/lib/utils";

type VistaPrincipal = "proyectos" | "perfil";
type Periodo = "dia" | "semana" | "mes";

export default function TableroPage() {
  const [vistaPrincipal, setVistaPrincipal] = useState<VistaPrincipal>("proyectos");

  // ── Estado de fecha COMPARTIDO entre ambas vistas ──
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [base, setBase] = useState<Date>(() => startOfISOWeek(new Date()));

  // Etiqueta de rango para el header
  const rangoLabel = (() => {
    if (periodo === "semana") return `${format(base, "d MMM", { locale: es })} – ${format(addWeeks(base, 5), "d MMM yyyy", { locale: es })}`;
    if (periodo === "mes")    return `${format(base, "MMM", { locale: es })} – ${format(addMonths(base, 4), "MMM yyyy", { locale: es })}`;
    // dia: muestra la semana
    return `${format(startOfISOWeek(base), "d MMM", { locale: es })} – ${format(addDays(startOfISOWeek(base), 6), "d MMM yyyy", { locale: es })}`;
  })();

  function navPrev() {
    if (periodo === "dia")    setBase((b) => addDays(startOfISOWeek(b), -7));
    if (periodo === "semana") setBase((b) => subWeeks(b, 5));
    if (periodo === "mes")    setBase((b) => subMonths(b, 4));
  }
  function navNext() {
    if (periodo === "dia")    setBase((b) => addDays(startOfISOWeek(b), 7));
    if (periodo === "semana") setBase((b) => addWeeks(b, 5));
    if (periodo === "mes")    setBase((b) => addMonths(b, 4));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header estático — idéntico en ambas vistas ── */}
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <h1 className="text-[16px] font-bold flex-1">Tablero</h1>

        {/* Toggle principal */}
        <div className="flex bg-[#f0f0f0] rounded-lg p-[3px] gap-[2px]">
          <button
            onClick={() => setVistaPrincipal("proyectos")}
            className={cn("px-3.5 py-[5px] rounded-md text-xs font-semibold transition-all",
              vistaPrincipal === "proyectos" ? "bg-white text-[#1a1a1a] shadow-sm" : "text-[#888] hover:text-[#555]"
            )}
          >Vista Proyectos</button>
          <button
            onClick={() => setVistaPrincipal("perfil")}
            className={cn("px-3.5 py-[5px] rounded-md text-xs font-semibold transition-all",
              vistaPrincipal === "perfil" ? "bg-white text-[#1a1a1a] shadow-sm" : "text-[#888] hover:text-[#555]"
            )}
          >Perfil Individual</button>
        </div>

        {/* Selector Día / Semana / Mes — siempre visible */}
        <div className="flex bg-[#f0f0f0] rounded-lg p-[3px] gap-[2px]">
          {(["dia", "semana", "mes"] as Periodo[]).map((pv) => (
            <button key={pv} onClick={() => setPeriodo(pv)}
              className={cn("px-3.5 py-[5px] rounded-md text-xs font-semibold transition-all",
                periodo === pv ? "bg-white text-[#1a1a1a] shadow-sm" : "text-[#888] hover:text-[#555]"
              )}
            >
              {pv === "dia" ? "Día" : pv === "semana" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>

        {/* Navegador de fechas — siempre visible */}
        <div className="flex items-center gap-2">
          <button onClick={navPrev} className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="font-semibold text-[#1a1a1a] min-w-[220px] text-center text-xs">{rangoLabel}</span>
          <button onClick={navNext} className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setBase(startOfISOWeek(new Date()))}
            className="ml-1 text-xs px-2.5 py-1 rounded-md border border-[#e0e0e0] hover:bg-[#f5f5f5] transition-colors text-[#555]"
          >Hoy</button>
        </div>
      </header>

      {/* ── Contenido — p-6 uniforme en ambas vistas ── */}
      <div className="flex-1 min-h-0 p-6 flex flex-col">

        {/* Vista Proyectos: controles de fecha manejados por el header */}
        {vistaPrincipal === "proyectos" && (
          <div className="bg-white rounded-xl shadow-md flex-1 min-h-0 overflow-hidden flex flex-col p-6">
            <DesgloceEngagements vistaExterna={periodo} baseExterna={base} />
          </div>
        )}

        {/* Vista Perfil Individual */}
        {vistaPrincipal === "perfil" && (
          <div className="overflow-auto flex-1 min-h-0">
            <div className="bg-white rounded-xl shadow-md p-6">
              <PerfilIndividualTablero semanaInicio={base} periodoVista={periodo} />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
