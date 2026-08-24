"use client";

import { useState, useEffect } from "react";
import { Pencil, ChevronDown } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { format, intervalToDuration } from "date-fns";
import { es } from "date-fns/locale";
import { getDetailedPersonAbsences, type DetalleAusenciasPersona, COLOR_AUSENCIA } from "@/lib/queries/ausencias";
import { getIniciales } from "@/lib/utils/iniciales";
import { calculateBusinessDays } from "@/lib/utils/date-utils";
import { type ExperienciaDinamica, type EngagementExperienciaRow } from "@/lib/queries/personas";
import { sincronizarExperienciaPersona } from "@/lib/queries/engagements";
import { HistorialProyectosAccordion } from "./ProyectosPersonaDetalle";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PersonaForm } from "./PersonaForm";
import { TalentMatrix, getTalentBoxName } from "./TalentMatrix";
import { EngagementDetalleModal } from "./EngagementDetalleModal";
import { NotebookPanel } from "./notebook/NotebookPanel";
import { CARGO_COLORS, CARGO_COLOR_DEFAULT, CARGOS_OCULTOS_GYD } from "@/lib/constants";
import type { Persona } from "@/lib/types/database";

interface Props {
  id: string;
}

interface AsignacionActiva {
  id: string;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  cargo_al_momento: string;
  engagement_id: string;
  engagement_nombre: string;
}

// ── Desarrollo de Carrera ─────────────────────────────────────
const ESCALONES_SENIORITY = [
  "Trainee",
  "Consultor Analista",
  "Consultor de Proyectos",
  "Senior",
  "Asociado",
  "Gerente",
  "Director",
] as const;

interface CargoDBRow {
  cargo: string;
  fechaInicio: string;
  fechaFin: string;   // "Presente" si fecha_fin es null
  actual: boolean;
  esApalancador: boolean;
  esReferente: boolean;
}

function fmtDuracion(fechaInicio: string, fechaFin: string): string {
  const dias = calculateBusinessDays(fechaInicio, fechaFin);
  if (dias <= 0) return "";
  const meses = Math.floor(dias / 22); // ~22 días hábiles por mes
  const resto  = dias % 22;
  if (meses === 0) return `${dias} días háb.`;
  if (resto  === 0) return `${meses} ${meses === 1 ? "mes" : "meses"}`;
  return `${meses} ${meses === 1 ? "mes" : "meses"} y ${resto} días`;
}

function fmtMesAnio(iso: string): string {
  if (iso === "Presente") return "Presente";
  const [y, m, d] = iso.split("-");
  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return `${parseInt(d)} de ${MESES[parseInt(m) - 1]} ${y}`;
}

function diasEnEmpresa(fechaIngreso: string | null): string | null {
  if (!fechaIngreso) return null;
  const total = Math.floor((Date.now() - new Date(fechaIngreso + "T00:00:00").getTime()) / 86_400_000);
  if (total < 0) return null;
  const years = Math.floor(total / 365);
  const months = Math.floor((total % 365) / 30);
  const days = (total % 365) % 30;
  const partes: string[] = [];
  if (years > 0) partes.push(`${years} ${years === 1 ? "año" : "años"}`);
  if (months > 0) partes.push(`${months} ${months === 1 ? "mes" : "meses"}`);
  if (days > 0 || partes.length === 0) partes.push(`${days} ${days === 1 ? "día" : "días"}`);
  return partes.length === 1 ? partes[0] : partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1];
}

function colorOcupacion(pct: number) {
  if (pct === 0)   return { bg: "#f0f0f0", text: "#888" };
  if (pct <= 50)   return { bg: "#dcf5e7", text: "#1e7e45" };
  if (pct <= 80)   return { bg: "#fff4d4", text: "#8a6200" };
  if (pct <= 100)  return { bg: "#ffe4c4", text: "#c45000" };
  return { bg: "#ffd4d4", text: "#c02020" };
}

/** Botón discreto de colapsar/expandir sección, con flecha que rota según el estado. */
function BotonColapsarSeccion({ colapsada, onClick }: { colapsada: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={colapsada ? "Expandir sección" : "Colapsar sección"}
      className="p-1 rounded hover:bg-[#f5f5f5] text-[#bbb] hover:text-[#555] transition-colors flex-shrink-0"
    >
      <ChevronDown
        className="w-4 h-4"
        style={{ transform: colapsada ? "rotate(-90deg)" : "none", transition: "transform 0.2s" }}
      />
    </button>
  );
}

export function PersonaProfile({ id }: Props) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [rolActual, setRolActual] = useState<string | null>(null);
  const [experiencia, setExperiencia] = useState<ExperienciaDinamica>({ industrias: [], capacidades: [], tematicas: [] });
  const [modalTag, setModalTag] = useState<{ tipo: string; nombre: string; engagements: EngagementExperienciaRow[] } | null>(null);
  const [asignaciones, setAsignaciones] = useState<AsignacionActiva[]>([]);
  const [mentor, setMentor] = useState<Persona | null>(null);
  const [mentoreados, setMentoreados] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(false);
  const [editSeccionInicial, setEditSeccionInicial] = useState<"desarrollo-carrera" | undefined>(undefined);
  const [isEditingTalent, setIsEditingTalent] = useState(false);
  const [showMatriz, setShowMatriz] = useState(false);
  const [talentDraft, setTalentDraft] = useState<{ p: number | null; d: number | null }>({ p: null, d: null });
  const [ausenciasDetalle, setAusenciasDetalle] = useState<DetalleAusenciasPersona | null>(null);
  const [detalleEngId,     setDetalleEngId]     = useState<string | null>(null);
  const [historialCargosDB, setHistorialCargosDB] = useState<CargoDBRow[]>([]);

  // Secciones colapsadas — persistidas en localStorage por persona, para recordar la
  // preferencia del usuario al recargar o volver a esta página.
  const [seccionesColapsadas, setSeccionesColapsadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const guardado = localStorage.getItem(`persona_profile_collapsed_${id}`);
      setSeccionesColapsadas(guardado ? new Set(JSON.parse(guardado)) : new Set());
    } catch {
      setSeccionesColapsadas(new Set());
    }
  }, [id]);

  function toggleSeccion(seccion: string) {
    setSeccionesColapsadas((prev) => {
      const next = new Set(prev);
      if (next.has(seccion)) next.delete(seccion); else next.add(seccion);
      if (typeof window !== "undefined") {
        localStorage.setItem(`persona_profile_collapsed_${id}`, JSON.stringify([...next]));
      }
      return next;
    });
  }

  const load = async () => {
    const supabase = createAnyClient();
    const hoy = new Date().toISOString().slice(0, 10);

    const [pRes, asigRes, mentoreRes, cargosRes] = await Promise.all([
      supabase.from("persona").select("*").eq("id", id).single(),

      // Solo asignaciones vigentes HOY (fecha_inicio <= hoy y fecha_fin null o futura) de
      // engagements activos y no borrados: las históricas/finalizadas (ej. migradas) o de
      // engagements en papelera no deben sumar a la ocupación actual.
      supabase
        .from("asignacion")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select("id, pct_dedicacion, fecha_inicio, fecha_fin, cargo_al_momento, engagement:engagement_id!inner(id, nombre, estado, is_deleted)" as any)
        .eq("persona_id", id)
        .eq("estado", "activa")
        .eq("engagement.estado", "activo")
        .eq("engagement.is_deleted", false)
        .lte("fecha_inicio", hoy)
        .or(`fecha_fin.is.null,fecha_fin.gte.${hoy}`)
        .order("fecha_inicio"),

      // Personas a las que esta persona hace de mentor
      supabase
        .from("persona")
        .select("id, nombre, apellido, cargo_actual")
        .eq("mentor_id", id)
        .eq("activo", true)
        .order("apellido"),

      // Historial de cargos (Desarrollo de Carrera)
      supabase
        .from("historial_cargos")
        .select("cargo, fecha_inicio, fecha_fin, es_apalancador, es_referente")
        .eq("persona_id", id)
        .order("fecha_inicio", { ascending: true }),
    ]);

    if (pRes.data) {
      const p = pRes.data as Persona;
      setPersona(p);
      // Cargar mentor si tiene uno asignado
      if (p.mentor_id) {
        const { data: mentorData } = await supabase
          .from("persona")
          .select("id, nombre, apellido, cargo_actual")
          .eq("id", p.mentor_id)
          .single();
        setMentor(mentorData as Persona ?? null);
      } else {
        setMentor(null);
      }
    }

    setAsignaciones(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (asigRes.data ?? []).map((r: any) => ({
        id: r.id,
        pct_dedicacion: Number(r.pct_dedicacion),
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        cargo_al_momento: r.cargo_al_momento,
        engagement_id: r.engagement?.id ?? "",
        engagement_nombre: r.engagement?.nombre ?? "—",
      }))
    );

    setMentoreados((mentoreRes.data ?? []) as Persona[]);
    // Preferencias y experiencia: recalculada retroactivamente a partir de TODOS los
    // engagements pasados (solo cuentan los de más de 10 días hábiles sin ausencias) y
    // sincronizada de forma persistente al perfil (persona_industria/capacidad/tematica).
    const [ausencias, experienciaData] = await Promise.all([
      getDetailedPersonAbsences(supabase, id),
      sincronizarExperienciaPersona(supabase, id),
    ]);
    setAusenciasDetalle(ausencias);
    setExperiencia(experienciaData);

    setHistorialCargosDB(
      ((cargosRes.data ?? []) as { cargo: string; fecha_inicio: string; fecha_fin: string | null; es_apalancador: boolean | null; es_referente: boolean | null }[]).map(
        (r) => ({
          cargo:       r.cargo,
          fechaInicio: r.fecha_inicio,
          fechaFin:    r.fecha_fin ?? "Presente",
          actual:      r.fecha_fin === null,
          esApalancador: r.es_apalancador ?? false,
          esReferente:   r.es_referente ?? false,
        })
      )
    );

    setLoading(false);
  };

  useEffect(() => {
    load();
    // Cargar rol del usuario actual para protección de acceso
    (async () => {
      const sb = createAnyClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb.from("persona").select("rol_sistema").eq("auth_user_id", user.id).single();
      setRolActual((data as any)?.rol_sistema ?? null);
    })();
  }, [id]);

  if (loading) return (
    <div className="p-6 animate-pulse">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-[#eee] flex-shrink-0" />
        <div className="space-y-2">
          <div className="h-4 w-40 bg-[#eee] rounded" />
          <div className="h-3 w-28 bg-[#f2f2f2] rounded" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-24 bg-[#f2f2f2] rounded-xl" />
        <div className="h-24 bg-[#f2f2f2] rounded-xl" />
      </div>
    </div>
  );
  if (!persona) return <p className="text-sm text-red-500 p-6">Persona no encontrada.</p>;

  const CARGOS_OCULTOS_AYSR = [...CARGOS_OCULTOS_GYD, "Asociado", "Consultor Senior", "Analista Senior"];
  const ocultarAusenciasYPreferencias =
    ((rolActual === "GyD" || rolActual === "planificador") && CARGOS_OCULTOS_GYD.includes(persona.cargo_actual ?? "")) ||
    (rolActual === "AySr" && CARGOS_OCULTOS_AYSR.includes(persona.cargo_actual ?? ""));

  const initials = getIniciales(persona.nombre, persona.apellido, persona.iniciales);
  const pctTotal = asignaciones.reduce((sum, a) => sum + a.pct_dedicacion, 0);
  const { bg: bgOcp, text: textOcp } = colorOcupacion(pctTotal);
  const cargoColor = CARGO_COLORS[persona.cargo_actual ?? ""] ?? CARGO_COLOR_DEFAULT;
  const talentBoxName = getTalentBoxName(persona.talento_potencial, persona.talento_desempeno);


  return (
    <>
      <div className="max-w-2xl space-y-5">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6 flex items-start justify-between gap-5">
          <div className="flex items-center gap-5">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0"
              style={{ backgroundColor: cargoColor }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold">
                  {persona.nombre} {persona.apellido}
                </h2>
                {talentBoxName && !(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#f0f4ff] text-[#3b5bdb] border border-[#c5d0fa] font-medium">
                    {talentBoxName}
                  </span>
                )}
                {!persona.activo && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#f0f0f0] text-[#888]">
                    Inactivo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <p className="font-semibold text-sm" style={{ color: cargoColor }}>{persona.cargo_actual ?? "Sin cargo"}</p>
              </div>
              <div className="flex gap-2 mt-1.5 flex-wrap">
                {persona.is_leverager && !(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-[#f0f4ff] text-[#3b5bdb] border border-[#c5d0fa]">
                    Apalancador
                  </span>
                )}
                {persona.referente && rolActual === "admin" && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-[#fff7ed] text-[#b45309] border border-[#fed7aa]">
                    • Referente
                  </span>
                )}
                {persona.rol_sistema && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#eaf4ff] text-[#1a5276] font-medium">
                    {persona.rol_sistema}
                  </span>
                )}
                {!(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && (
                <span
                  className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                  style={{ background: bgOcp, color: textOcp }}
                >
                  {pctTotal}% ocupado actualmente
                </span>
                )}
                {diasEnEmpresa(persona.fecha_ingreso) && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#f8f8f8] text-[#888] border border-[#ebebeb]">
                    ⌛ {diasEnEmpresa(persona.fecha_ingreso)} en la empresa
                  </span>
                )}
              </div>
            </div>
          </div>
          {!(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setEditSeccionInicial(undefined); setEditando(true); }}
              className="text-[#888] hover:text-[#1a1a1a]"
              title="Editar"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          </div>
          )}
        </div>

        {/* ── Info ───────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Información</h3>
            <BotonColapsarSeccion colapsada={seccionesColapsadas.has("informacion")} onClick={() => toggleSeccion("informacion")} />
          </div>
          {!seccionesColapsadas.has("informacion") && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-[#888]">Email</dt>
              <dd className="font-medium mt-0.5">{persona.email}</dd>
            </div>
            {persona.fecha_ingreso && (
              <div>
                <dt className="text-[#888]">Fecha de ingreso</dt>
                <dd className="font-medium mt-0.5">
                  {format(new Date(persona.fecha_ingreso + "T00:00:00"), "d 'de' MMMM yyyy", { locale: es })}
                </dd>
              </div>
            )}
            {persona.fecha_nacimiento && (
              <div>
                <dt className="text-[#888]">Fecha de nacimiento</dt>
                <dd className="font-medium mt-0.5">
                  {format(new Date(persona.fecha_nacimiento + "T00:00:00"), "d 'de' MMMM yyyy", { locale: es })}
                </dd>
              </div>
            )}
            {mentor && (
              <div>
                <dt className="text-[#888]">Mentor</dt>
                <dd className="font-medium mt-0.5 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#4a90e2] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    {mentor.nombre[0]}{mentor.apellido[0]}
                  </div>
                  {mentor.nombre} {mentor.apellido}
                </dd>
              </div>
            )}
            {mentoreados.length > 0 && (
              <div className="col-span-2">
                <dt className="text-[#888] mb-1.5">Es mentor de</dt>
                <dd className="flex flex-wrap gap-2">
                  {mentoreados.map((m) => (
                    <span
                      key={m.id}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#f0f9f4] text-[#1e7e45] font-medium"
                    >
                      <div className="w-4 h-4 rounded-full bg-[#4ab89a] flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                        {m.nombre[0]}{m.apellido[0]}
                      </div>
                      {m.nombre} {m.apellido}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
          )}
        </div>

        {/* ── Matriz de Talento 9-Box ──────────────────────── */}
        {rolActual !== "planificador" && rolActual !== "GyD" && rolActual !== "AySr" && <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Matriz de Talento</h3>
            <BotonColapsarSeccion colapsada={seccionesColapsadas.has("matriz-talento")} onClick={() => toggleSeccion("matriz-talento")} />
          </div>
          {!seccionesColapsadas.has("matriz-talento") && (
          <>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setShowMatriz((s) => !s)}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            >
              <span className="text-sm font-medium text-[#555]">Ver matriz 9-box</span>
              <ChevronDown
                className="w-4 h-4 text-gray-400"
                style={{ transform: showMatriz ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
              />
            </button>
            {!isEditingTalent ? (
              <button
                onClick={() => {
                  setTalentDraft({ p: persona.talento_potencial, d: persona.talento_desempeno });
                  setIsEditingTalent(true);
                }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#555] hover:bg-[#f5f5f5] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Editar
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditingTalent(false)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#888] hover:bg-[#f5f5f5] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    if (talentDraft.p == null || talentDraft.d == null) return;
                    const supabase = createAnyClient();
                    const { error } = await supabase
                      .from("persona")
                      .update({ talento_potencial: talentDraft.p, talento_desempeno: talentDraft.d })
                      .eq("id", persona.id);
                    if (!error) {
                      setPersona((prev) => prev ? { ...prev, talento_potencial: talentDraft.p, talento_desempeno: talentDraft.d } : prev);
                      setIsEditingTalent(false);
                    }
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a2e] text-white hover:bg-[#2d2d4e] transition-colors"
                >
                  Guardar
                </button>
              </div>
            )}
          </div>
          {showMatriz && (
            <TalentMatrix
              potencial={isEditingTalent ? talentDraft.p : persona.talento_potencial}
              desempeno={isEditingTalent ? talentDraft.d : persona.talento_desempeno}
              isEditable={isEditingTalent}
              onUpdate={(p, d) => setTalentDraft({ p, d })}
            />
          )}
          </>
          )}
        </div>}

        {/* ── Historial de proyectos: acordeón por año ──────── */}
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Historial de proyectos</h3>
            <BotonColapsarSeccion colapsada={seccionesColapsadas.has("historial-proyectos")} onClick={() => toggleSeccion("historial-proyectos")} />
          </div>

          {!seccionesColapsadas.has("historial-proyectos") && (
            <HistorialProyectosAccordion
              personaId={id}
              personaNombreCompleto={`${persona.nombre} ${persona.apellido}`}
              rolActual={rolActual}
              onVerDetalle={setDetalleEngId}
            />
          )}
        </div>

        {/* ── Historial de Ausencias ───────────────────────── */}
        {!ocultarAusenciasYPreferencias && ausenciasDetalle && (
          <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold">Ausencias</h3>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-3xl font-bold text-[#1a1a2e]">{ausenciasDetalle.totalDiasAnioActual}</span>
                  <p className="text-xs text-[#888] mt-0.5">días utilizados {new Date().getFullYear()}</p>
                </div>
                <BotonColapsarSeccion colapsada={seccionesColapsadas.has("ausencias")} onClick={() => toggleSeccion("ausencias")} />
              </div>
            </div>

            {!seccionesColapsadas.has("ausencias") && (ausenciasDetalle.ausenciasFuturas.length === 0 && ausenciasDetalle.ausenciasPasadasAnioActual.length === 0 ? (
              <p className="text-sm text-[#ccc] italic">Sin ausencias registradas este año.</p>
            ) : (
              <div className="space-y-5">
                {/* Próximas ausencias */}
                {ausenciasDetalle.ausenciasFuturas.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                      Próximas ausencias
                    </p>
                    <div className="space-y-2">
                      {ausenciasDetalle.ausenciasFuturas.map((a) => {
                        const color = COLOR_AUSENCIA[a.tipo]?.bg ?? "#9ca3af";
                        return (
                          <div key={a.id}
                            className="flex items-center justify-between p-3 rounded-lg border"
                            style={{ background: color + "18", borderColor: color + "44" }}
                          >
                            <div>
                              <p className="text-sm font-medium text-[#1a1a2e]">{a.tipoLabel}</p>
                              <p className="text-xs text-[#888] mt-0.5">
                                {format(new Date(a.fechaInicio + "T00:00:00"), "d MMM", { locale: es })}
                                {" → "}
                                {format(new Date(a.fechaFin + "T00:00:00"), "d MMM yyyy", { locale: es })}
                              </p>
                              {a.descripcion && (
                                <p className="text-xs text-[#aaa] mt-0.5 italic">{a.descripcion}</p>
                              )}
                            </div>
                            <span
                              className="flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-full text-white ml-3"
                              style={{ background: color }}
                            >
                              {a.numDias}d
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Registro histórico del año */}
                {ausenciasDetalle.ausenciasPasadasAnioActual.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                      Registro histórico {new Date().getFullYear()}
                    </p>
                    <div className="space-y-1.5">
                      {ausenciasDetalle.ausenciasPasadasAnioActual.map((a) => (
                        <div key={a.id}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-[#f9f9f9] border border-[#f0f0f0]"
                        >
                          <div>
                            <p className="text-sm text-[#555] font-medium">{a.tipoLabel}</p>
                            <p className="text-xs text-[#888] mt-0.5">
                              {format(new Date(a.fechaInicio + "T00:00:00"), "d MMM", { locale: es })}
                              {" → "}
                              {format(new Date(a.fechaFin + "T00:00:00"), "d MMM", { locale: es })}
                            </p>
                          </div>
                          <span className="text-xs text-[#888] flex-shrink-0 ml-3">{a.numDias} días</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Preferencias y experiencia ─────────────────────── */}
        {!ocultarAusenciasYPreferencias && (
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Preferencias y experiencia</h3>
            <BotonColapsarSeccion colapsada={seccionesColapsadas.has("preferencias")} onClick={() => toggleSeccion("preferencias")} />
          </div>
          {!seccionesColapsadas.has("preferencias") && (
          <div className="space-y-5">

            <div>
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                Industrias
              </p>
              {experiencia.industrias.length === 0 ? (
                <p className="text-sm text-[#ccc] italic">Sin industrias definidas</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {experiencia.industrias.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setModalTag({ tipo: "Industria", nombre: t.nombre, engagements: t.engagements })}
                      className="text-xs px-2.5 py-1 rounded-full bg-[#eaf4ff] text-[#1a5276] font-medium hover:bg-[#d7ebff] transition-colors cursor-pointer"
                    >
                      {t.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-2">
                Temáticas
              </p>
              {experiencia.tematicas.length === 0 ? (
                <p className="text-sm text-[#ccc] italic">Sin temáticas definidas</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {experiencia.tematicas.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setModalTag({ tipo: "Temática", nombre: t.nombre, engagements: t.engagements })}
                      className="text-xs px-2.5 py-1 rounded-full bg-[#fdf4ff] text-[#6b21a8] font-medium hover:bg-[#f5e4ff] transition-colors cursor-pointer"
                    >
                      {t.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>
          )}
        </div>
        )}
        {/* ── Desarrollo de Carrera ───────────────────────── */}
        {!(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-semibold">Desarrollo de Carrera</h3>
              <p className="text-xs text-[#aaa] mt-0.5">Escalones de seniority recorridos</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#aaa] font-medium">
                {historialCargosDB.length === 0 ? "Sin registros" : `${historialCargosDB.length} periodo${historialCargosDB.length > 1 ? "s" : ""}`}
              </span>
              <button
                onClick={() => { setEditSeccionInicial("desarrollo-carrera"); setEditando(true); }}
                className="p-1 rounded hover:bg-[#f5f5f5] text-[#888] hover:text-[#1a1a1a] transition-colors"
                title="Editar Desarrollo de Carrera"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <BotonColapsarSeccion colapsada={seccionesColapsadas.has("desarrollo-carrera")} onClick={() => toggleSeccion("desarrollo-carrera")} />
            </div>
          </div>

          {!seccionesColapsadas.has("desarrollo-carrera") && (
          <>
          {/* Escalones horizontales */}
          <div className="overflow-x-auto pb-2">
            <div className="flex items-start gap-0 min-w-max">
              {(() => {
                // Modo dinámico si: rol_sistema es Desarrollo, o el historial
                // contiene cargos que no pertenecen a la lista fija de escalones
                const tieneCargoLibre = historialCargosDB.some(
                  (h) => !(ESCALONES_SENIORITY as readonly string[]).includes(h.cargo)
                );
                if (persona.rol_sistema === "Desarrollo" || tieneCargoLibre) {
                  if (historialCargosDB.length === 0) {
                    return (
                      <p className="text-[12px] text-[#ccc] italic py-4">
                        Sin periodos registrados aún.
                      </p>
                    );
                  }
                  return historialCargosDB.map((entrada, idx) => {
                    const esUltimo = idx === historialCargosDB.length - 1;
                    return (
                      <div key={idx} className="flex items-center">
                        <div className="flex flex-col items-center" style={{ width: 110 }}>
                          <div
                            className="relative flex items-center justify-center rounded-full border-2 transition-all duration-300"
                            style={{
                              width: entrada.actual ? 52 : 40,
                              height: entrada.actual ? 52 : 40,
                              background: entrada.actual
                                ? "linear-gradient(135deg,#3b82f6,#1d4ed8)"
                                : "#dbeafe",
                              borderColor: entrada.actual ? "#1d4ed8" : "#93c5fd",
                              boxShadow: entrada.actual ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
                            }}
                          >
                            <span className="text-[11px] font-bold" style={{ color: entrada.actual ? "#fff" : "#2563eb" }}>
                              {idx + 1}
                            </span>
                            {!entrada.actual && (
                              <span className="absolute -top-1 -right-1 text-[9px] bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
                                ✓
                              </span>
                            )}
                            {(entrada.esReferente || entrada.esApalancador) && (
                              <span
                                className="absolute -top-1 -left-1 text-[9px] text-white rounded-full w-4 h-4 flex items-center justify-center font-bold"
                                style={{ background: entrada.esReferente ? "#7c3aed" : "#d97706" }}
                                title={entrada.esReferente ? "Referente" : "Apalancador"}
                              >
                                {entrada.esReferente ? "R" : "A"}
                              </span>
                            )}
                          </div>
                          {entrada.actual && (
                            <span className="mt-1.5 text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white uppercase tracking-wide">
                              Actual
                            </span>
                          )}
                          <p className="text-center mt-2 leading-tight px-1 text-[10px] font-semibold"
                            style={{ color: entrada.actual ? "#1d4ed8" : "#374151", maxWidth: 100, wordBreak: "break-word" }}>
                            {entrada.cargo}
                          </p>
                          <div className="mt-1.5 text-center">
                            <p className="text-[9px] text-[#60a5fa] font-medium leading-tight">{fmtMesAnio(entrada.fechaInicio)}</p>
                            <p className="text-[9px] text-[#9ca3af] leading-tight">→ {fmtMesAnio(entrada.fechaFin)}</p>
                            <p className="text-[8px] text-[#c0c0c0] leading-tight mt-0.5 italic">
                              {fmtDuracion(entrada.fechaInicio, entrada.actual ? new Date().toISOString().split("T")[0] : entrada.fechaFin)}
                            </p>
                          </div>
                          {(entrada.esApalancador || entrada.esReferente) && (
                            <div className="mt-1 flex flex-col items-center gap-0.5">
                              {entrada.esApalancador && (
                                <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">• Apalancador</span>
                              )}
                              {entrada.esReferente && (
                                <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 whitespace-nowrap">• Referente</span>
                              )}
                            </div>
                          )}
                        </div>
                        {!esUltimo && (
                          <div className="flex-shrink-0 h-0.5 bg-[#93c5fd]" style={{ width: 20, marginBottom: 20 }} />
                        )}
                      </div>
                    );
                  });
                }

                // Consultoría: escalones fijos, iluminados según BD
                return ESCALONES_SENIORITY.map((escalon, idx) => {
                  const entrada   = historialCargosDB.find((h) => h.cargo === escalon);
                  const alcanzado = !!entrada;
                  const esActual  = entrada?.actual ?? false;
                  const esUltimo  = idx === ESCALONES_SENIORITY.length - 1;
                  return (
                    <div key={escalon} className="flex items-center">
                      <div className="flex flex-col items-center" style={{ width: 100 }}>
                        <div
                          className="relative flex items-center justify-center rounded-full border-2 transition-all duration-300"
                          style={{
                            width: esActual ? 52 : 40,
                            height: esActual ? 52 : 40,
                            background: alcanzado ? (esActual ? "linear-gradient(135deg,#3b82f6,#1d4ed8)" : "#dbeafe") : "#f3f4f6",
                            borderColor: alcanzado ? (esActual ? "#1d4ed8" : "#93c5fd") : "#e5e7eb",
                            boxShadow: esActual ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
                          }}
                        >
                          <span className="text-[11px] font-bold" style={{ color: alcanzado ? (esActual ? "#fff" : "#2563eb") : "#d1d5db" }}>
                            {idx + 1}
                          </span>
                          {alcanzado && !esActual && (
                            <span className="absolute -top-1 -right-1 text-[9px] bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
                              ✓
                            </span>
                          )}
                          {entrada && (entrada.esReferente || entrada.esApalancador) && (
                            <span
                              className="absolute -top-1 -left-1 text-[9px] text-white rounded-full w-4 h-4 flex items-center justify-center font-bold"
                              style={{ background: entrada.esReferente ? "#7c3aed" : "#d97706" }}
                              title={entrada.esReferente ? "Referente" : "Apalancador"}
                            >
                              {entrada.esReferente ? "R" : "A"}
                            </span>
                          )}
                        </div>
                        {esActual && (
                          <span className="mt-1.5 text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white uppercase tracking-wide">
                            Actual
                          </span>
                        )}
                        <p className="text-center mt-2 leading-tight px-1"
                          style={{ fontSize: 10, fontWeight: alcanzado ? 600 : 400, color: alcanzado ? (esActual ? "#1d4ed8" : "#374151") : "#9ca3af", maxWidth: 90, wordBreak: "break-word" }}>
                          {escalon}
                        </p>
                        {entrada && (
                          <div className="mt-1.5 text-center">
                            <p className="text-[9px] text-[#60a5fa] font-medium leading-tight">{fmtMesAnio(entrada.fechaInicio)}</p>
                            <p className="text-[9px] text-[#9ca3af] leading-tight">→ {fmtMesAnio(entrada.fechaFin)}</p>
                            <p className="text-[8px] text-[#c0c0c0] leading-tight mt-0.5 italic">
                              {fmtDuracion(entrada.fechaInicio, entrada.actual ? new Date().toISOString().split("T")[0] : entrada.fechaFin)}
                            </p>
                          </div>
                        )}
                        {entrada && (entrada.esApalancador || entrada.esReferente) && (
                          <div className="mt-1 flex flex-col items-center gap-0.5" style={{ maxWidth: 100 }}>
                            {entrada.esApalancador && (
                              <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-center leading-tight">• Apalancador</span>
                            )}
                            {entrada.esReferente && (
                              <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-center leading-tight">• Referente</span>
                            )}
                          </div>
                        )}
                      </div>
                      {!esUltimo && (() => {
                        const sigAlcanzado = !!historialCargosDB.find((h) => h.cargo === ESCALONES_SENIORITY[idx + 1]);
                        return (
                          <div className="flex-shrink-0 h-0.5 transition-colors duration-300"
                            style={{ width: 20, background: alcanzado && sigAlcanzado ? "#93c5fd" : "#e5e7eb", marginBottom: 20 }} />
                        );
                      })()}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Leyenda */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-[#f0f0f0]">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-200 border border-blue-300" />
              <span className="text-[10px] text-[#888]">Completado</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-600" />
              <span className="text-[10px] text-[#888]">Cargo actual</span>
            </div>
            {persona.rol_sistema !== "Desarrollo" && (
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-gray-100 border border-gray-200" />
                <span className="text-[10px] text-[#888]">Por alcanzar</span>
              </div>
            )}
          </div>
          </>
          )}
        </div>}

        {/* ── Notebook de Desarrollo ──────────────────────── */}
        {!(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && (
        <div className="bg-white rounded-xl border border-[#e8e8e8] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Notebook de Desarrollo</h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-medium">Anotaciones privadas del colaborador</span>
              <BotonColapsarSeccion colapsada={seccionesColapsadas.has("notebook")} onClick={() => toggleSeccion("notebook")} />
            </div>
          </div>
          {!seccionesColapsadas.has("notebook") && (
            <NotebookPanel personaId={id} personaNombre={`${persona.nombre} ${persona.apellido}`} />
          )}
        </div>
        )}

      </div>

      {/* Formulario de edición */}
      {persona && (
        <PersonaForm
          open={editando}
          onClose={() => { setEditando(false); setEditSeccionInicial(undefined); }}
          onSuccess={() => {
            setEditando(false);
            setEditSeccionInicial(undefined);
            load();
          }}
          persona={persona}
          isAdmin={rolActual === "admin"}
          initialSection={editSeccionInicial}
        />
      )}

      {/* Modal de detalle del engagement */}
      {detalleEngId && (
        <EngagementDetalleModal
          engagementId={detalleEngId}
          personaId={id}
          onClose={() => setDetalleEngId(null)}
        />
      )}

      {/* Modal de engagements asociados a una industria/capacidad/temática */}
      <Modal
        open={!!modalTag}
        onClose={() => setModalTag(null)}
        title={modalTag?.nombre ?? ""}
      >
        {modalTag && (
          modalTag.engagements.length === 0 ? (
            <p className="text-sm text-[#ccc] italic">Sin engagements asociados.</p>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {[...modalTag.engagements]
                .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio))
                .map((e) => (
                  <div key={e.engagement_id} className="flex items-center justify-between gap-3 py-2.5 border-b border-[#f0f0f0] last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1a1a2e] truncate">{e.nombre}</p>
                      {e.cliente && <p className="text-xs text-[#888] truncate">{e.cliente}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-[#555] whitespace-nowrap">
                        {format(new Date(e.fecha_inicio + "T00:00:00"), "d MMM", { locale: es })}
                        {" → "}
                        {e.fecha_fin ? format(new Date(e.fecha_fin + "T00:00:00"), "d MMM", { locale: es }) : "Presente"}
                      </p>
                      <p className="text-[11px] text-[#aaa] whitespace-nowrap mt-0.5">({e.diasHabiles} días hábiles)</p>
                    </div>
                  </div>
                ))}
            </div>
          )
        )}
      </Modal>
    </>
  );
}
