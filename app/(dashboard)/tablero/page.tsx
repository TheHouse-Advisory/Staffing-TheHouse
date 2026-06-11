"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { createClient, createAnyClient } from "@/lib/supabase/client";
import type { RolSistema } from "@/lib/types/database";
import { startOfISOWeek, addWeeks, subWeeks, addMonths, subMonths, addDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DesgloceEngagements, type PanelInfo } from "@/components/inicio/DesgloceEngagements";
import { PerfilIndividualTablero } from "@/components/inicio/PerfilIndividualTablero";
import { PanelFitAsignacion } from "@/components/engagements/PanelFitAsignacion";
import { cn } from "@/lib/utils";

type VistaPrincipal = "proyectos" | "perfil";
type Periodo = "dia" | "semana" | "mes";

// Componente interno que lee useSearchParams — debe estar dentro de <Suspense>
function TableroContent() {
  const searchParams = useSearchParams();
  const openEngagementId = searchParams.get("openEngagementId") ?? undefined;
  const [vistaPrincipal, setVistaPrincipal] = useState<VistaPrincipal>("proyectos");
  const [rol, setRol] = useState<RolSistema | null>(null);
  const isReadOnly = rol === "Desarrollo" || rol === "planificador" || rol === "GyD";

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const sb = createAnyClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await sb.from("persona").select("rol_sistema").eq("auth_user_id", user.id).single();
      setRol((data?.rol_sistema as RolSistema) ?? null);
    })();
  }, []);

  // ── Panel lateral de recomendaciones (mismo patrón que inicio/page.tsx) ──
  const [panelReq,       setPanelReq]       = useState<PanelInfo | null>(null);
  const [panelColapsado, setPanelColapsado] = useState(false);
  const [tableroReloadKey, setTableroReloadKey] = useState(0);

  function abrirPanel(info: PanelInfo | null) {
    setPanelReq(info);
    if (info) setPanelColapsado(false);
  }

  // ── Estado de fecha COMPARTIDO entre ambas vistas ──
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [base, setBase] = useState<Date>(() => startOfISOWeek(new Date()));

  // Etiqueta de rango para el header
  const rangoLabel = (() => {
    if (periodo === "semana") return `${format(base, "d MMM", { locale: es })} – ${format(addWeeks(base, 9), "d MMM yyyy", { locale: es })}`;
    if (periodo === "mes")    return `${format(base, "MMM", { locale: es })} – ${format(addMonths(base, 8), "MMM yyyy", { locale: es })}`;
    // dia: muestra la semana
    return `${format(startOfISOWeek(base), "d MMM", { locale: es })} – ${format(addDays(startOfISOWeek(base), 6), "d MMM yyyy", { locale: es })}`;
  })();

  function navPrev() {
    if (periodo === "dia")    setBase((b) => addDays(startOfISOWeek(b), -7));
    if (periodo === "semana") setBase((b) => subWeeks(b, 9));
    if (periodo === "mes")    setBase((b) => subMonths(b, 8));
  }
  function navNext() {
    if (periodo === "dia")    setBase((b) => addDays(startOfISOWeek(b), 7));
    if (periodo === "semana") setBase((b) => addWeeks(b, 9));
    if (periodo === "mes")    setBase((b) => addMonths(b, 8));
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

        {/* Vista Proyectos — split-screen cuando el panel de recomendaciones está activo */}
        {vistaPrincipal === "proyectos" && (
          <div className="flex gap-4 flex-1 min-h-0">

            {/* Tablero principal — se contrae limpiamente al abrir el panel */}
            <div className="bg-white rounded-xl shadow-md flex-1 min-h-0 overflow-hidden flex flex-col p-6">
              <DesgloceEngagements
                vistaExterna={periodo}
                baseExterna={base}
                openEngagementId={openEngagementId}
                externalReloadKey={tableroReloadKey}
                onOpenPanel={abrirPanel}
                readOnly={isReadOnly}
              />
            </div>

            {/* Panel lateral de recomendaciones — animación width 0 → 380px */}
            <div
              className="flex-shrink-0 overflow-hidden transition-all duration-500 ease-in-out"
              style={{ width: !panelReq ? 0 : panelColapsado ? 40 : 380 }}
            >
              {panelReq && (
                panelColapsado ? (
                  /* Strip colapsado */
                  <div className="w-10 h-full rounded-xl border border-gray-100 shadow-sm bg-white flex flex-col items-center py-3 gap-3">
                    <button
                      onClick={() => setPanelColapsado(false)}
                      title="Expandir recomendaciones"
                      className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors">
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span
                      className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex-1 flex items-center"
                      style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
                      Recomendaciones
                    </span>
                  </div>
                ) : (
                  /* Panel expandido */
                  <div className="w-[380px] h-full rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    <PanelFitAsignacion
                      reqId={panelReq.reqId}
                      engagementId={panelReq.engId}
                      engagementNombre={panelReq.engNombre}
                      engagementCliente={panelReq.engCliente}
                      onClose={() => setPanelReq(null)}
                      onCollapse={() => setPanelColapsado(true)}
                      onAsignado={() => {
                        setPanelReq(null);
                        setPanelColapsado(false);
                        setTableroReloadKey((k) => k + 1);
                      }}
                    />
                  </div>
                )
              )}
            </div>

          </div>
        )}

        {/* Vista Perfil Individual */}
        {vistaPrincipal === "perfil" && (
          <div className="bg-white rounded-xl shadow-md p-6 flex-1 min-h-0 overflow-hidden flex flex-col">
            <PerfilIndividualTablero semanaInicio={base} periodoVista={periodo} />
          </div>
        )}

      </div>
    </div>
  );
}

export default function TableroPage() {
  return (
    <Suspense fallback={null}>
      <TableroContent />
    </Suspense>
  );
}
