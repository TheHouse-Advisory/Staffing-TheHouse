"use client";

import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { startOfISOWeek, addWeeks, subWeeks, format } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { GanttAusencias } from "@/components/inicio/GanttAusencias";
import { TablonOcupacion } from "@/components/tablero/TablonOcupacion";
import { PerfilIndividualTablero } from "@/components/inicio/PerfilIndividualTablero";
import type { Persona } from "@/lib/types/database";

const JERARQUIA_CARGOS = [
  "Socio",
  "Director de Proyectos",
  "Director",
  "Gerente de Proyectos",
  "Gerente",
  "Asociado",
  "Consultor Senior",
  "Consultor de Proyectos",
  "Consultor Proyecto",
  "Consultor",
  "Consultor Analista",
  "Analista Senior",
  "Consultor Trainee",
  "Analista",
  "Practicante",
];

const COLORES: Record<string, string> = {
  "Socio":                  "#1a1a2e",
  "Director de Proyectos":  "#4a90e2",
  "Director":               "#4a90e2",
  "Gerente de Proyectos":   "#7c5cbf",
  "Gerente":                "#7c5cbf",
  "Asociado":               "#e2884a",
  "Consultor Senior":       "#4ab89a",
  "Consultor de Proyectos": "#e24a6a",
  "Consultor Analista":     "#a0b84a",
  "Consultor Trainee":      "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";

const TALENTO_CONFIG = {
  talento:        { label: "Talento",        bg: "#f0fdf4", color: "#16a34a" },
  en_desarrollo:  { label: "En desarrollo",  bg: "#fefce8", color: "#ca8a04" },
  no_talento:     { label: "No talento",     bg: "#fef2f2", color: "#dc2626" },
};

function iniciales(nombre: string, apellido: string) {
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

function ordenarCargos(cargos: string[]): string[] {
  return [...cargos].sort((a, b) => {
    const ia = JERARQUIA_CARGOS.indexOf(a);
    const ib = JERARQUIA_CARGOS.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

interface ResumenPersona {
  ocupacion: number;
  totalProyectos: number;
  industrias: string[];
  capacidades: string[];
  tematicas: string[];
  vacacionesDias: number;
  mentorNombre: string | null;
  mentoreados: string[];
}

export default function InicioPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);

  // Tablero (cuadrante 2)
  const [semanaInicio, setSemanaInicio] = useState<Date>(() => startOfISOWeek(new Date()));
  const [vistaTablero, setVistaTablero] = useState<"persona" | "proyecto" | "perfil">("persona");
  const semanaLabel = `${format(semanaInicio, "d MMM", { locale: es })} – ${format(addWeeks(semanaInicio, 1), "d MMM yyyy", { locale: es })}`;

  // Popup
  const [seleccionada, setSeleccionada] = useState<Persona | null>(null);
  const [resumen, setResumen] = useState<ResumenPersona | null>(null);
  const [loadingResumen, setLoadingResumen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const [persRes] = await Promise.all([
        sb.from("persona").select("*").eq("activo", true).order("cargo_actual").order("apellido"),
      ]);

      setPersonas(persRes.data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  // Cerrar popup al hacer clic fuera
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setSeleccionada(null);
        setResumen(null);
      }
    }
    if (seleccionada) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [seleccionada]);

  async function abrirResumen(p: Persona) {
    setSeleccionada(p);
    setResumen(null);
    setLoadingResumen(true);
    const sb = createAnyClient();

    const añoActual = new Date().getFullYear();

    const [asigRes, histRes, vacRes, mentorRes, indRes, capRes, temRes, mentoreRes] = await Promise.all([
      // Ocupación actual
      sb.from("asignacion")
        .select("pct_dedicacion")
        .eq("persona_id", p.id)
        .eq("estado", "activa"),

      // Total de proyectos históricos
      sb.from("asignacion")
        .select("engagement_id")
        .eq("persona_id", p.id),

      // Total de ausencias del año en curso
      sb.from("ausencia")
        .select("id", { count: "exact", head: true })
        .eq("persona_id", p.id)
        .gte("fecha_inicio", `${añoActual}-01-01`)
        .lte("fecha_fin",   `${añoActual}-12-31`),

      // Nombre del mentor
      p.mentor_id
        ? sb.from("persona").select("nombre, apellido").eq("id", p.mentor_id).single()
        : Promise.resolve({ data: null }),

      // Industrias
      sb.from("persona_industria")
        .select("cat_industria(nombre)")
        .eq("persona_id", p.id),

      // Capacidades
      sb.from("persona_capacidad")
        .select("cat_capacidad(nombre)")
        .eq("persona_id", p.id),

      // Temáticas
      sb.from("persona_tematica")
        .select("cat_tematica(nombre)")
        .eq("persona_id", p.id),

      // Personas que esta persona mentora
      sb.from("persona")
        .select("nombre, apellido")
        .eq("mentor_id", p.id)
        .eq("activo", true),
    ]);

    const ocupacion = (asigRes.data ?? []).reduce(
      (sum: number, a: any) => sum + Number(a.pct_dedicacion), 0
    );

    const engagementsUnicos = new Set(
      (histRes.data ?? []).map((a: any) => a.engagement_id)
    );

    const industriasLista = (indRes.data ?? []).map((r: any) => r.cat_industria?.nombre).filter(Boolean) as string[];
    const capacidadesLista = (capRes.data ?? []).map((r: any) => r.cat_capacidad?.nombre).filter(Boolean) as string[];
    const tematicasLista = (temRes.data ?? []).map((r: any) => r.cat_tematica?.nombre).filter(Boolean) as string[];

    const vacDias = vacRes.count ?? 0;

    const mentorData = mentorRes.data as { nombre: string; apellido: string } | null;

    setResumen({
      ocupacion,
      totalProyectos: engagementsUnicos.size,
      industrias: industriasLista,
      capacidades: capacidadesLista,
      tematicas: tematicasLista,
      vacacionesDias: vacDias,
      mentorNombre: mentorData ? `${mentorData.nombre} ${mentorData.apellido}` : null,
      mentoreados: ((mentoreRes.data ?? []) as { nombre: string; apellido: string }[])
        .map((m) => `${m.nombre} ${m.apellido}`),
    });
    setLoadingResumen(false);
  }

  // Agrupar por cargo
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
      <div>
        <h1 className="text-[22px] font-bold text-[#1a1a2e]">Menú Principal</h1>
        <p className="text-sm text-gray-400 mt-0.5">Resumen general del equipo</p>
      </div>

      <div className="grid gap-4 flex-1 min-h-0" style={{ gridTemplateColumns: "1fr 2fr", gridTemplateRows: "2fr 1fr" }}>

        {/* ── Cuadrante 1: Equipo por cargo ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col overflow-hidden relative">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
            Equipo
          </p>

          {loading ? (
            <p className="text-sm text-gray-300">Cargando...</p>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {cargos.map((cargo) => {
                const color = COLORES[cargo] ?? COLOR_DEFAULT;
                return (
                  <div key={cargo}>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      {cargo}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {grupos[cargo].map((p) => (
                        <button
                          key={p.id}
                          onClick={() => abrirResumen(p)}
                          title={`${p.nombre} ${p.apellido}`}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 hover:scale-110 hover:shadow-md transition-transform"
                          style={{ backgroundColor: color }}
                        >
                          {iniciales(p.nombre, p.apellido)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Popup de resumen ── */}
          {seleccionada && (
            <div className="absolute inset-0 bg-black/10 rounded-xl z-10 flex items-center justify-center p-4">
              <div
                ref={popupRef}
                className="bg-white rounded-xl shadow-xl border border-gray-100 w-full max-w-xs relative flex flex-col"
                style={{ maxHeight: "85%" }}
              >
                {/* Header fijo */}
                <div className="p-5 pb-3 flex-shrink-0">
                  <button
                    onClick={() => { setSeleccionada(null); setResumen(null); }}
                    className="absolute top-3 right-3 text-gray-300 hover:text-gray-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
                      style={{ backgroundColor: colorSeleccionada }}
                    >
                      {iniciales(seleccionada.nombre, seleccionada.apellido)}
                    </div>
                    <div>
                      <p className="font-bold text-[#1a1a2e]">
                        {seleccionada.nombre} {seleccionada.apellido}
                      </p>
                      <p className="text-xs text-gray-400">{seleccionada.cargo_actual ?? "Sin cargo"}</p>
                    </div>
                  </div>
                </div>

                {/* Contenido scrolleable */}
                <div className="overflow-y-auto px-5 pb-5 flex-1">
                {loadingResumen ? (
                  <p className="text-sm text-gray-300 text-center py-4">Cargando...</p>
                ) : resumen && (
                  <div className="space-y-3 text-sm">

                    {/* Disponibilidad */}
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Disponibilidad</span>
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

                    {/* Historial proyectos */}
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Nº proyectos</span>
                      <span className="font-medium text-[#1a1a2e]">{resumen.totalProyectos}</span>
                    </div>

                    {/* Industrias */}
                    <div>
                      <p className="text-gray-400 mb-1">Industrias</p>
                      {resumen.industrias.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {resumen.industrias.map((i) => (
                            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#eaf4ff] text-[#1a5276]">{i}</span>
                          ))}
                        </div>
                      ) : <p className="text-xs text-gray-300 italic">Sin industrias</p>}
                    </div>

                    {/* Capacidades */}
                    <div>
                      <p className="text-gray-400 mb-1">Capacidades</p>
                      {resumen.capacidades.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {resumen.capacidades.map((c) => (
                            <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45]">{c}</span>
                          ))}
                        </div>
                      ) : <p className="text-xs text-gray-300 italic">Sin capacidades</p>}
                    </div>

                    {/* Temáticas */}
                    <div>
                      <p className="text-gray-400 mb-1">Temáticas</p>
                      {resumen.tematicas.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {resumen.tematicas.map((t) => (
                            <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-[#fdf4ff] text-[#6b21a8]">{t}</span>
                          ))}
                        </div>
                      ) : <p className="text-xs text-gray-300 italic">Sin temáticas</p>}
                    </div>

                    {/* Ausencias */}
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Ausencias</span>
                      <span className="font-medium text-[#1a1a2e]">
                        {resumen.vacacionesDias}
                      </span>
                    </div>

                    {/* Talento */}
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Talento</span>
                      {seleccionada.talento ? (
                        <span
                          className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                          style={{
                            background: TALENTO_CONFIG[seleccionada.talento].bg,
                            color:      TALENTO_CONFIG[seleccionada.talento].color,
                          }}
                        >
                          {TALENTO_CONFIG[seleccionada.talento].label}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">Sin asignar</span>
                      )}
                    </div>

                    {/* Mentor */}
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Mentor</span>
                      <span className="font-medium text-[#1a1a2e]">
                        {resumen.mentorNombre ?? <span className="text-gray-300 text-xs">Sin mentor</span>}
                      </span>
                    </div>

                    {/* Es mentor de */}
                    {resumen.mentoreados.length > 0 && (
                      <div>
                        <p className="text-gray-400 mb-1">Es mentor de</p>
                        <div className="flex flex-wrap gap-1">
                          {resumen.mentoreados.map((m) => (
                            <span key={m} className="text-xs px-2 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45] font-medium">
                              {m}
                            </span>
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

        {/* ── Cuadrante 2: Tablero ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Tablero</p>
            <div className="flex items-center gap-2">
              {/* Toggle vistas */}
              <div className="flex rounded-md overflow-hidden border border-gray-100 text-[11px] font-semibold">
                {([
                  { value: "persona", label: "Por persona" },
                  { value: "proyecto", label: "Por proyecto" },
                  { value: "perfil",   label: "Perfil individual" },
                ] as const).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setVistaTablero(value)}
                    className="px-2.5 py-1 transition-colors"
                    style={
                      vistaTablero === value
                        ? { background: "#4a90e2", color: "#fff" }
                        : { background: "#f9f9f9", color: "#888" }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Navegación semana */}
              <button onClick={() => setSemanaInicio((s) => subWeeks(s, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] text-gray-400 whitespace-nowrap">{semanaLabel}</span>
              <button onClick={() => setSemanaInicio((s) => addWeeks(s, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Contenido según vista */}
          <div className="flex-1 overflow-auto min-h-0">
            {vistaTablero === "perfil" ? (
              <PerfilIndividualTablero semanaInicio={semanaInicio} />
            ) : (
              <TablonOcupacion
                semanaInicio={semanaInicio}
                planId={null}
                vista={vistaTablero}
              />
            )}
          </div>
        </div>

        {/* ── Cuadrante 3 ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
            Cuadrante 3
          </p>
          <div className="flex-1 flex items-center justify-center text-gray-300 text-sm">
            Próximamente…
          </div>
        </div>

        {/* ── Cuadrante 4: Gantt Ausencias ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 overflow-hidden">
          <GanttAusencias onVerPersona={abrirResumen} />
        </div>

      </div>
    </div>
  );
}
