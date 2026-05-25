"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  startOfISOWeek, addWeeks, subWeeks, addMonths, subMonths,
  format, isSameDay, parseISO,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Bell, BarChart2 } from "lucide-react";
import Link from "next/link";
import { createAnyClient } from "@/lib/supabase/client";
import { GanttAusencias } from "@/components/inicio/GanttAusencias";
import { PerfilIndividualTablero } from "@/components/inicio/PerfilIndividualTablero";
import { DesgloceEngagements, type PanelInfo } from "@/components/inicio/DesgloceEngagements";
import { DisponiblesTablero, type AsigDetalle } from "@/components/inicio/DisponiblesTablero";
import { PanelFitAsignacion } from "@/components/engagements/PanelFitAsignacion";
import { PersonaResumenModal } from "@/components/personas/PersonaResumenModal";
import type { Persona } from "@/lib/types/database";

const JERARQUIA_CARGOS = [
  "Socio", "Director de Proyectos", "Director", "Gerente de Proyectos", "Gerente",
  "Asociado", "Consultor Senior", "Consultor de Proyectos", "Consultor Proyecto",
  "Consultor", "Consultor Analista", "Analista Senior", "Consultor Trainee", "Analista", "Practicante",
];

const COLORES: Record<string, string> = {
  "Socio": "#1a1a2e", "Director de Proyectos": "#4a90e2", "Director": "#4a90e2",
  "Gerente de Proyectos": "#7c5cbf", "Gerente": "#7c5cbf", "Asociado": "#e2884a",
  "Consultor Senior": "#4ab89a", "Consultor de Proyectos": "#e24a6a",
  "Consultor Analista": "#a0b84a", "Consultor Trainee": "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";

function iniciales(nombre: string, apellido: string) {
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

function ordenarCargos(cargos: string[]) {
  return [...cargos].sort((a, b) => {
    const ia = JERARQUIA_CARGOS.indexOf(a), ib = JERARQUIA_CARGOS.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/** Color del indicador de ocupación: rojo ≥90%, amarillo ≥60%, verde <60% */
function ocupColor(pct: number) {
  if (pct >= 90) return { bg: "#fef2f2", text: "#dc2626" };
  if (pct >= 60) return { bg: "#fefce8", text: "#ca8a04" };
  return { bg: "#f0fdf4", text: "#16a34a" };
}


export default function InicioPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [ocupacionMap, setOcupacionMap] = useState<Record<string, number>>({});
  const [asignacionesDetalle, setAsignacionesDetalle] = useState<AsigDetalle[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertasHoy, setAlertasHoy] = useState(0);

  // Estado cuadrante EQUIPO: colapsado strip | normal 200px | expandido flex-1
  const [equipoEstado, setEquipoEstado] = useState<"normal" | "colapsado" | "expandido">("normal");

  // Panel lateral de recomendaciones
  const [panelReq, setPanelReq] = useState<PanelInfo | null>(null);
  const [panelColapsado, setPanelColapsado] = useState(false);
  const [tableroReloadKey, setTableroReloadKey] = useState(0);

  function abrirPanel(info: PanelInfo | null) {
    setPanelReq(info);
    if (info) setPanelColapsado(false); // siempre expandido al abrir
  }

  // Control expansión columna derecha
  const [activeQuadrant, setActiveQuadrant] = useState<"both" | "tablero" | "resumen">("both");

  // RESÚMEN quadrant
  const [vistaResumen, setVistaResumen] = useState<"gantt" | "perfil">("gantt");
  const [semanaResumen, setSemanaResumen] = useState(() => startOfISOWeek(new Date()));
  const [periodoResumen, setPeriodoResumen] = useState<"dia" | "semana" | "mes">("dia");

  function navResumenPrev() {
    if (periodoResumen === "semana") setSemanaResumen((s) => subWeeks(s, 5));
    else if (periodoResumen === "mes") setSemanaResumen((s) => subMonths(s, 4));
    else setSemanaResumen((s) => subWeeks(s, 1));
  }
  function navResumenNext() {
    if (periodoResumen === "semana") setSemanaResumen((s) => addWeeks(s, 5));
    else if (periodoResumen === "mes") setSemanaResumen((s) => addMonths(s, 4));
    else setSemanaResumen((s) => addWeeks(s, 1));
  }
  const periodoLabel =
    periodoResumen === "semana"
      ? `${format(semanaResumen, "d MMM", { locale: es })} – ${format(addWeeks(semanaResumen, 5), "d MMM yyyy", { locale: es })}`
      : periodoResumen === "mes"
      ? `${format(semanaResumen, "MMM", { locale: es })} – ${format(addMonths(semanaResumen, 4), "MMM yyyy", { locale: es })}`
      : `${format(semanaResumen, "d MMM", { locale: es })} – ${format(addWeeks(semanaResumen, 1), "d MMM yyyy", { locale: es })}`;

  // Popup persona
  const [seleccionada, setSeleccionada] = useState<Persona | null>(null);

  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const hoy = format(new Date(), "yyyy-MM-dd");

      const [persRes, asigRes, asigDetalleRes] = await Promise.all([
        sb.from("persona")
          .select("id, nombre, apellido, cargo_actual, is_leverager, fecha_ingreso")
          .eq("activo", true).order("cargo_actual").order("apellido"),
        sb.from("asignacion")
          .select("persona_id, pct_dedicacion")
          .eq("estado", "activa")
          .lte("fecha_inicio", hoy)
          .gte("fecha_fin", hoy),
        (sb as any).from("asignacion")
          .select("persona_id, fecha_fin, engagement:engagement_id(tipo)")
          .eq("estado", "activa")
          .lte("fecha_inicio", hoy)
          .gte("fecha_fin", hoy),
      ]);

      const pers = (persRes.data ?? []) as Persona[];
      setPersonas(pers);

      // Mapa ocupación hoy
      const map: Record<string, number> = {};
      for (const a of (asigRes.data ?? []) as { persona_id: string; pct_dedicacion: number }[]) {
        map[a.persona_id] = (map[a.persona_id] ?? 0) + Number(a.pct_dedicacion);
      }
      setOcupacionMap(map);

      // Detalle de asignaciones para DisponiblesTablero
      setAsignacionesDetalle(
        ((asigDetalleRes.data ?? []) as any[]).map((a) => ({
          persona_id: a.persona_id,
          fecha_fin: a.fecha_fin,
          tipo: a.engagement?.tipo ?? "proyecto",
        }))
      );

      // Aniversarios hoy
      const hoyDate = new Date();
      const conAniv = pers.filter((p) => {
        if (!p.fecha_ingreso) return false;
        const ingreso = parseISO(p.fecha_ingreso);
        const aniv = new Date(hoyDate.getFullYear(), ingreso.getMonth(), ingreso.getDate());
        return isSameDay(aniv, hoyDate) && hoyDate.getFullYear() - ingreso.getFullYear() > 0;
      });
      setAlertasHoy(conAniv.length);
      setLoading(false);
    }
    load();
  }, []);

  /** Re-fetch ocupación tras una asignación nueva o eliminada */
  const refreshOcupacion = useCallback(async () => {
    const sb = createAnyClient();
    const hoy = format(new Date(), "yyyy-MM-dd");
    const { data } = await sb.from("asignacion")
      .select("persona_id, pct_dedicacion")
      .eq("estado", "activa")
      .lte("fecha_inicio", hoy)
      .gte("fecha_fin", hoy);
    const map: Record<string, number> = {};
    for (const a of (data ?? []) as { persona_id: string; pct_dedicacion: number }[]) {
      map[a.persona_id] = (map[a.persona_id] ?? 0) + Number(a.pct_dedicacion);
    }
    setOcupacionMap(map);
  }, []);

  // Escucha cambios de asignación desde cualquier componente (tablero, formularios, etc.)
  useEffect(() => {
    window.addEventListener("asignacionChanged", refreshOcupacion);
    return () => window.removeEventListener("asignacionChanged", refreshOcupacion);
  }, [refreshOcupacion]);

  function abrirResumen(p: Persona) { setSeleccionada(p); }

  // Agrupar personas por cargo — memoizado: solo cambia con `personas`,
  // no en cada toggle de la UI (paneles, cuadrantes, navegación de fechas).
  const { grupos, cargos } = useMemo(() => {
    const grupos: Record<string, Persona[]> = {};
    for (const p of personas) {
      const cargo = p.cargo_actual ?? "Sin cargo";
      if (!grupos[cargo]) grupos[cargo] = [];
      grupos[cargo].push(p);
    }
    return { grupos, cargos: ordenarCargos(Object.keys(grupos)) };
  }, [personas]);

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      {/* Top bar */}
      <div className="flex items-start justify-between flex-shrink-0">
        <div>
          <h1 className="text-[22px] font-bold text-[#1a1a2e]">Menú Principal</h1>
          <p className="text-sm text-gray-400 mt-0.5">Resumen general del equipo</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/alertas"
            className="relative flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-[#4a90e2] transition-colors text-sm font-semibold text-[#1a1a2e] shadow-sm"
          >
            <Bell className="w-4 h-4 text-[#4a90e2]" />
            Alertas
            {alertasHoy > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {alertasHoy}
              </span>
            )}
          </Link>
          <Link
            href="/reportes"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-[#4a90e2] transition-colors text-sm font-semibold text-[#1a1a2e] shadow-sm"
          >
            <BarChart2 className="w-4 h-4 text-[#4a90e2]" />
            Reportes
          </Link>
        </div>
      </div>

      {/* Layout 3 columnas: EQUIPO | TABLERO+RESUMEN | RECOMENDACIONES */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* ── Columna izquierda: EQUIPO + DISPONIBLES ── */}
        <div
          className="flex flex-col gap-4 overflow-hidden transition-all duration-500 ease-in-out"
          style={
            equipoEstado === "colapsado"
              ? { flexGrow: 0, flexShrink: 0, flexBasis: 40 }
              : equipoEstado === "normal"
              ? { flexGrow: 0, flexShrink: 0, flexBasis: 200 }
              : { flexGrow: 1, flexShrink: 1, flexBasis: "0%", minWidth: 0 }
          }
        >
        {/* EQUIPO ocupa el espacio flexible */}
        <div className="flex-1 min-h-0 overflow-hidden">
        {equipoEstado === "colapsado" ? (
          /* Strip colapsado */
          <div className="w-10 h-full rounded-xl border border-gray-100 shadow-sm bg-white flex flex-col items-center py-3 gap-3">
            <button
              onClick={() => setEquipoEstado("normal")}
              title="Expandir equipo"
              className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <span
              className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex-1 flex items-center"
              style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
            >
              Equipo
            </span>
          </div>
        ) : (
        <div className="w-full h-full bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col overflow-hidden relative">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Equipo</p>
            <div className="flex items-center gap-0.5">
              {equipoEstado === "expandido" ? (
                /* Expandido: un solo botón vuelve a normal */
                <button
                  onClick={() => setEquipoEstado("normal")}
                  title="Reducir equipo"
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              ) : (
                /* Normal: colapsar al strip | expandir */
                <>
                  <button
                    onClick={() => setEquipoEstado("colapsado")}
                    title="Colapsar equipo"
                    className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEquipoEstado("expandido")}
                    title="Ampliar equipo"
                    className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-300">Cargando...</p>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {cargos.map((cargo) => {
                const color = COLORES[cargo] ?? COLOR_DEFAULT;
                return (
                  <div key={cargo}>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{cargo}</p>
                    <div className="flex flex-wrap gap-2">
                      {grupos[cargo].map((p) => {
                        const pct = Math.round(ocupacionMap[p.id] ?? 0);
                        const oc = ocupColor(pct);
                        return (
                          <button
                            key={p.id}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData("persona", JSON.stringify({
                              personaId: p.id,
                              nombre: p.nombre,
                              apellido: p.apellido,
                              cargo_actual: p.cargo_actual,
                            }))}
                            onClick={() => abrirResumen(p)}
                            title={`${p.nombre} ${p.apellido} — ${pct}% ocupado${p.is_leverager ? " · Apalancador" : ""}`}
                            className="flex flex-col items-center gap-0.5 hover:scale-110 transition-transform cursor-grab active:cursor-grabbing"
                          >
                            <div className="relative">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold shadow-sm"
                                style={{ backgroundColor: color }}
                              >
                                {iniciales(p.nombre, p.apellido)}
                              </div>
                              {/* Indicador Apalancador */}
                              {p.is_leverager && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#3b5bdb] border-2 border-white flex items-center justify-center text-white font-bold leading-none" style={{ fontSize: 7 }}>
                                  A
                                </span>
                              )}
                            </div>
                            <span
                              className="text-[9px] font-bold px-1 py-0.5 rounded-full leading-none"
                              style={{ background: oc.bg, color: oc.text }}
                            >
                              {pct}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Popup resumen persona — sólo visible cuando equipo está expandido */}
          {seleccionada && (
            <PersonaResumenModal
              personaId={seleccionada.id}
              onClose={() => setSeleccionada(null)}
            />
          )}
        </div>
        )}{/* fin ternario equipo expandido */}
        </div>{/* fin wrapper flex-1 EQUIPO */}

        {/* DISPONIBLES PRÓXIMAMENTE — oculto en strip colapsado */}
        {equipoEstado !== "colapsado" && (
          <DisponiblesTablero
            personas={personas}
            asignaciones={asignacionesDetalle}
          />
        )}
        </div>{/* fin columna izquierda */}

        {/* ── Columna central: TABLERO arriba + RESÚMEN abajo ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0 overflow-hidden">

        {/* Cuadrante 2: TABLERO */}
        <div
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col overflow-hidden transition-all duration-500 ease-in-out"
          style={
            activeQuadrant === "resumen"
              ? { flexGrow: 0, flexShrink: 0, flexBasis: "44px" }
              : { flexGrow: 1, flexShrink: 1, flexBasis: "0%" }
          }
        >
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Tablero</p>
            <button
              onClick={() => setActiveQuadrant((q) => q === "tablero" ? "both" : "tablero")}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
              title={activeQuadrant === "tablero" ? "Restaurar" : "Expandir tablero"}
            >
              {activeQuadrant === "tablero" ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            <DesgloceEngagements
              onAsignacionChange={refreshOcupacion}
              onOpenPanel={abrirPanel}
              externalReloadKey={tableroReloadKey}
            />
          </div>
        </div>

        {/* Cuadrante 3: RESÚMEN */}
        <div
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col overflow-hidden transition-all duration-500 ease-in-out"
          style={
            activeQuadrant === "tablero"
              ? { flexGrow: 0, flexShrink: 0, flexBasis: "44px" }
              : { flexGrow: 1, flexShrink: 1, flexBasis: "0%" }
          }
        >
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Resúmen</p>
            <div className="flex items-center gap-2">
              {/* Grupo 1: Toggle Ausencias / Perfil individual — oculto cuando colapsado */}
              {activeQuadrant !== "tablero" && (
                <div className="flex rounded-md overflow-hidden border border-gray-100 text-[11px] font-semibold">
                  <button
                    onClick={() => setVistaResumen("gantt")}
                    className="px-2.5 py-1 transition-colors"
                    style={vistaResumen === "gantt"
                      ? { background: "#4a90e2", color: "#fff" }
                      : { background: "#f9f9f9", color: "#888" }}
                  >
                    Ausencias
                  </button>
                  <button
                    onClick={() => setVistaResumen("perfil")}
                    className="px-2.5 py-1 transition-colors"
                    style={vistaResumen === "perfil"
                      ? { background: "#4a90e2", color: "#fff" }
                      : { background: "#f9f9f9", color: "#888" }}
                  >
                    Perfil individual
                  </button>
                </div>
              )}

              {/* Grupo 2: Granularidad temporal + navegación — oculto cuando colapsado */}
              {activeQuadrant !== "tablero" && (
                <div className="flex items-center gap-1">
                  <div className="flex rounded-md overflow-hidden border border-gray-100 text-[11px] font-semibold">
                    {(["dia", "semana", "mes"] as const).map((pv) => (
                      <button
                        key={pv}
                        onClick={() => setPeriodoResumen(pv)}
                        className="px-2 py-1 transition-colors"
                        style={periodoResumen === pv
                          ? { background: "#1a1a1a", color: "#fff" }
                          : { background: "#f9f9f9", color: "#888" }}
                      >
                        {pv === "dia" ? "Día" : pv === "semana" ? "Semana" : "Mes"}
                      </button>
                    ))}
                  </div>
                  <button onClick={navResumenPrev} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">{periodoLabel}</span>
                  <button onClick={navResumenNext} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Grupo 3: Expandir/colapsar — alineado con el botón del cuadrante Tablero */}
              <button
                onClick={() => setActiveQuadrant((q) => q === "resumen" ? "both" : "resumen")}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                title={activeQuadrant === "resumen" ? "Restaurar" : "Expandir resúmen"}
              >
                {activeQuadrant === "resumen" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto min-h-0">
            {vistaResumen === "gantt"
              ? <GanttAusencias onVerPersona={abrirResumen} vistaExterna={periodoResumen} baseExterna={semanaResumen} />
              : <PerfilIndividualTablero semanaInicio={semanaResumen} periodoVista={periodoResumen} />
            }
          </div>
        </div>

        </div>{/* fin columna central */}

        {/* ── Columna 3: Panel lateral RECOMENDACIONES ── */}
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
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span
                  className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex-1 flex items-center"
                  style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
                >
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
                    refreshOcupacion();
                    setTableroReloadKey((k) => k + 1);
                  }}
                />
              </div>
            )
          )}
        </div>

      </div>
    </div>
  );
}
