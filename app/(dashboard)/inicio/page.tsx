"use client";

import { useEffect, useRef, useState } from "react";
import {
  startOfISOWeek, addWeeks, subWeeks, addMonths, subMonths,
  format, isSameDay, parseISO,
} from "date-fns";
import { es } from "date-fns/locale";
import { X, ChevronLeft, ChevronRight, Bell } from "lucide-react";
import Link from "next/link";
import { createAnyClient } from "@/lib/supabase/client";
import { GanttAusencias } from "@/components/inicio/GanttAusencias";
import { PerfilIndividualTablero } from "@/components/inicio/PerfilIndividualTablero";
import { DesgloceEngagements } from "@/components/inicio/DesgloceEngagements";
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

const TALENTO_CONFIG = {
  talento:       { label: "Talento",       bg: "#f0fdf4", color: "#16a34a" },
  en_desarrollo: { label: "En desarrollo", bg: "#fefce8", color: "#ca8a04" },
  no_talento:    { label: "No talento",    bg: "#fef2f2", color: "#dc2626" },
};

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

interface ResumenPersona {
  ocupacion: number; totalProyectos: number; industrias: string[];
  capacidades: string[]; tematicas: string[]; vacacionesDias: number;
  mentorNombre: string | null; mentoreados: string[];
}

export default function InicioPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [ocupacionMap, setOcupacionMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [alertasHoy, setAlertasHoy] = useState(0);

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
  const [resumen, setResumen] = useState<ResumenPersona | null>(null);
  const [loadingResumen, setLoadingResumen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const hoy = format(new Date(), "yyyy-MM-dd");

      const [persRes, asigRes] = await Promise.all([
        sb.from("persona").select("*").eq("activo", true).order("cargo_actual").order("apellido"),
        sb.from("asignacion")
          .select("persona_id, pct_dedicacion")
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

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setSeleccionada(null); setResumen(null);
      }
    }
    if (seleccionada) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [seleccionada]);

  async function abrirResumen(p: Persona) {
    setSeleccionada(p); setResumen(null); setLoadingResumen(true);
    const sb = createAnyClient();
    const añoActual = new Date().getFullYear();

    const [asigRes, histRes, vacRes, mentorRes, indRes, capRes, temRes, mentoreRes] = await Promise.all([
      sb.from("asignacion").select("pct_dedicacion").eq("persona_id", p.id).eq("estado", "activa"),
      sb.from("asignacion").select("engagement_id").eq("persona_id", p.id),
      sb.from("ausencia").select("id", { count: "exact", head: true }).eq("persona_id", p.id)
        .gte("fecha_inicio", `${añoActual}-01-01`).lte("fecha_fin", `${añoActual}-12-31`),
      p.mentor_id
        ? sb.from("persona").select("nombre, apellido").eq("id", p.mentor_id).single()
        : Promise.resolve({ data: null }),
      sb.from("persona_industria").select("cat_industria(nombre)").eq("persona_id", p.id),
      sb.from("persona_capacidad").select("cat_capacidad(nombre)").eq("persona_id", p.id),
      sb.from("persona_tematica").select("cat_tematica(nombre)").eq("persona_id", p.id),
      sb.from("persona").select("nombre, apellido").eq("mentor_id", p.id).eq("activo", true),
    ]);

    const ocupacion = (asigRes.data ?? []).reduce((s: number, a: any) => s + Number(a.pct_dedicacion), 0);
    const engUnicos = new Set((histRes.data ?? []).map((a: any) => a.engagement_id));
    setResumen({
      ocupacion,
      totalProyectos: engUnicos.size,
      industrias:  (indRes.data ?? []).map((r: any) => r.cat_industria?.nombre).filter(Boolean) as string[],
      capacidades: (capRes.data ?? []).map((r: any) => r.cat_capacidad?.nombre).filter(Boolean) as string[],
      tematicas:   (temRes.data ?? []).map((r: any) => r.cat_tematica?.nombre).filter(Boolean) as string[],
      vacacionesDias: vacRes.count ?? 0,
      mentorNombre: mentorRes.data
        ? `${(mentorRes.data as any).nombre} ${(mentorRes.data as any).apellido}`
        : null,
      mentoreados: ((mentoreRes.data ?? []) as { nombre: string; apellido: string }[])
        .map((m) => `${m.nombre} ${m.apellido}`),
    });
    setLoadingResumen(false);
  }

  // Agrupar personas por cargo
  const grupos: Record<string, Persona[]> = {};
  for (const p of personas) {
    const cargo = p.cargo_actual ?? "Sin cargo";
    if (!grupos[cargo]) grupos[cargo] = [];
    grupos[cargo].push(p);
  }
  const cargos = ordenarCargos(Object.keys(grupos));
  const colorSeleccionada = seleccionada
    ? (COLORES[seleccionada.cargo_actual ?? ""] ?? COLOR_DEFAULT)
    : COLOR_DEFAULT;

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      {/* Top bar */}
      <div className="flex items-start justify-between flex-shrink-0">
        <div>
          <h1 className="text-[22px] font-bold text-[#1a1a2e]">Menú Principal</h1>
          <p className="text-sm text-gray-400 mt-0.5">Resumen general del equipo</p>
        </div>
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
      </div>

      {/* Grid 3 cuadrantes: EQUIPO | TABLERO | RESÚMEN */}
      <div className="grid gap-4 flex-1 min-h-0" style={{ gridTemplateColumns: "200px 2fr 1.5fr" }}>

        {/* ── Cuadrante 1: EQUIPO con % ocupación ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col overflow-hidden relative">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex-shrink-0">Equipo</p>

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
                            onClick={() => abrirResumen(p)}
                            title={`${p.nombre} ${p.apellido} — ${pct}% ocupado`}
                            className="flex flex-col items-center gap-0.5 hover:scale-110 transition-transform"
                          >
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold shadow-sm"
                              style={{ backgroundColor: color }}
                            >
                              {iniciales(p.nombre, p.apellido)}
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

          {/* Popup resumen persona */}
          {seleccionada && (
            <div className="absolute inset-0 bg-black/10 rounded-xl z-10 flex items-center justify-center p-3">
              <div
                ref={popupRef}
                className="bg-white rounded-xl shadow-xl border border-gray-100 w-full relative flex flex-col"
                style={{ maxHeight: "92%" }}
              >
                <div className="p-4 pb-2 flex-shrink-0">
                  <button
                    onClick={() => { setSeleccionada(null); setResumen(null); }}
                    className="absolute top-3 right-3 text-gray-300 hover:text-gray-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white text-base font-bold flex-shrink-0"
                      style={{ backgroundColor: colorSeleccionada }}
                    >
                      {iniciales(seleccionada.nombre, seleccionada.apellido)}
                    </div>
                    <div>
                      <p className="font-bold text-[#1a1a2e] text-sm">{seleccionada.nombre} {seleccionada.apellido}</p>
                      <p className="text-[11px] text-gray-400">{seleccionada.cargo_actual ?? "Sin cargo"}</p>
                    </div>
                  </div>
                </div>

                <div className="overflow-y-auto px-4 pb-4 flex-1">
                  {loadingResumen ? (
                    <p className="text-sm text-gray-300 text-center py-4">Cargando...</p>
                  ) : resumen && (
                    <div className="space-y-2.5 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400 text-xs">Disponibilidad</span>
                        <span
                          className="font-semibold px-2 py-0.5 rounded-full text-xs"
                          style={
                            resumen.ocupacion >= 100
                              ? { background: "#fef2f2", color: "#dc2626" }
                              : resumen.ocupacion >= 80
                              ? { background: "#fefce8", color: "#ca8a04" }
                              : { background: "#f0fdf4", color: "#16a34a" }
                          }
                        >
                          {Math.max(0, 100 - resumen.ocupacion)}% libre
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400 text-xs">Nº proyectos</span>
                        <span className="font-medium text-[#1a1a2e] text-xs">{resumen.totalProyectos}</span>
                      </div>
                      {resumen.industrias.length > 0 && (
                        <div>
                          <p className="text-gray-400 mb-1 text-xs">Industrias</p>
                          <div className="flex flex-wrap gap-1">
                            {resumen.industrias.map((i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#eaf4ff] text-[#1a5276]">{i}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {resumen.capacidades.length > 0 && (
                        <div>
                          <p className="text-gray-400 mb-1 text-xs">Capacidades</p>
                          <div className="flex flex-wrap gap-1">
                            {resumen.capacidades.map((c) => (
                              <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45]">{c}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {resumen.tematicas.length > 0 && (
                        <div>
                          <p className="text-gray-400 mb-1 text-xs">Temáticas</p>
                          <div className="flex flex-wrap gap-1">
                            {resumen.tematicas.map((t) => (
                              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#fdf4ff] text-[#6b21a8]">{t}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400 text-xs">Ausencias</span>
                        <span className="font-medium text-[#1a1a2e] text-xs">{resumen.vacacionesDias}</span>
                      </div>
                      {seleccionada.talento && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400 text-xs">Talento</span>
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              background: TALENTO_CONFIG[seleccionada.talento].bg,
                              color: TALENTO_CONFIG[seleccionada.talento].color,
                            }}
                          >
                            {TALENTO_CONFIG[seleccionada.talento].label}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400 text-xs">Mentor</span>
                        <span className="font-medium text-[#1a1a2e] text-xs">
                          {resumen.mentorNombre ?? <span className="text-gray-300">Sin mentor</span>}
                        </span>
                      </div>
                      {resumen.mentoreados.length > 0 && (
                        <div>
                          <p className="text-gray-400 mb-1 text-xs">Es mentor de</p>
                          <div className="flex flex-wrap gap-1">
                            {resumen.mentoreados.map((m) => (
                              <span key={m} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45] font-medium">{m}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Cuadrante 2: TABLERO (solo DesgloceEngagements) ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col overflow-hidden">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex-shrink-0">Tablero</p>
          <div className="flex-1 overflow-auto min-h-0">
            <DesgloceEngagements />
          </div>
        </div>

        {/* ── Cuadrante 3: RESÚMEN (toggle Gantt / Perfil individual) ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Resúmen</p>
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {/* Toggle Gantt / Perfil */}
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

              {/* Navegación temporal — solo visible en vista perfil */}
              {vistaResumen === "perfil" && (
                <>
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
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto min-h-0">
            {vistaResumen === "gantt"
              ? <GanttAusencias onVerPersona={abrirResumen} />
              : <PerfilIndividualTablero semanaInicio={semanaResumen} periodoVista={periodoResumen} />
            }
          </div>
        </div>

      </div>
    </div>
  );
}
