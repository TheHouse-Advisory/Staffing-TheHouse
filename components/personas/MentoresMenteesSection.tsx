"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Pencil, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { getIniciales } from "@/lib/utils/iniciales";
import { CARGO_COLORS, CARGO_COLOR_DEFAULT } from "@/lib/constants";
import { Modal } from "@/components/ui/Modal";

// Datos mínimos de persona para tarjetas y selector
export interface PersonaMini {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
}

// Fila de persona_mentoria con el mentor embebido (RLS: solo admin/personas)
interface Mentoria {
  id: string;
  fecha_inicio: string | null; // null = asignación previa al historial
  fecha_fin: string | null;    // null = vigente
  mentor: PersonaMini | null;
}

const fmtFecha = (f: string | null) => (f ? format(parseISO(f), "d MMM yyyy", { locale: es }) : "Sin fecha");

interface Props {
  personaId: string;
  mentor: PersonaMini | null;
  mentees: PersonaMini[];
  /** Notifica al perfil el nuevo mentor (null = sin mentor) tras guardar */
  onMentorChange: (mentor: PersonaMini | null) => void;
  colapsada?: boolean;
  /** Botón de colapsar del perfil (mantiene consistencia visual) */
  botonColapsar?: React.ReactNode;
}

function TarjetaPersona({ p, onQuitar, desde }: { p: PersonaMini; onQuitar?: () => void; desde?: string | null }) {
  const color = CARGO_COLORS[p.cargo_actual ?? ""] ?? CARGO_COLOR_DEFAULT;
  return (
    <div className="group relative flex items-center gap-3 border border-[#e8e8e8] rounded-lg p-3 bg-white/50 hover:bg-[#fafafa] transition-colors">
      <div className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: color }}>
        {getIniciales(p.nombre, p.apellido)}
      </div>
      <Link href={`/personas/${p.id}`} className="min-w-0 hover:underline">
        <p className="text-sm font-medium text-[#1a1a1a] truncate">{p.nombre} {p.apellido}</p>
        <p className="text-[11px] truncate" style={{ color }}>{p.cargo_actual ?? "Sin cargo"}</p>
        {desde !== undefined && (
          <p className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5">
            <CalendarDays className="w-3 h-3" /> {desde ? `Desde ${fmtFecha(desde)}` : "Fecha sin registro"}
          </p>
        )}
      </Link>
      {onQuitar && (
        <button
          onClick={onQuitar}
          title="Quitar mentor"
          className="ml-auto p-1 rounded text-[#aaa] hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function MentoresMenteesSection({ personaId, mentor, mentees, onMentorChange, colapsada = false, botonColapsar }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [personas, setPersonas] = useState<PersonaMini[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historial, setHistorial] = useState<Mentoria[]>([]);
  // Edición de una mentoría del historial (persona y fechas)
  const [editando, setEditando] = useState<Mentoria | null>(null);
  const [edMentorId, setEdMentorId] = useState("");
  const [edInicio, setEdInicio] = useState("");
  const [edFin, setEdFin] = useState("");
  const [fechaInicio, setFechaInicio] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const scrollRef = useRef<HTMLDivElement>(null);
  // Inicio de la mentoría vigente de cada mentee (persona_id → fecha_inicio)
  const [desdeMentee, setDesdeMentee] = useState<Record<string, string | null>>({});

  useEffect(() => {
    createAnyClient()
      .from("persona_mentoria")
      .select("persona_id, fecha_inicio")
      .eq("mentor_id", personaId)
      .is("fecha_fin", null)
      .then(({ data }: { data: { persona_id: string; fecha_inicio: string | null }[] | null }) =>
        setDesdeMentee(Object.fromEntries((data ?? []).map((r) => [r.persona_id, r.fecha_inicio]))));
  }, [personaId]);

  // Mentorías finalizadas donde esta persona fue mentora (más recientes primero)
  const [anteriores, setAnteriores] = useState<{ id: string; fecha_inicio: string | null; fecha_fin: string; persona: PersonaMini | null }[]>([]);
  useEffect(() => {
    createAnyClient()
      .from("persona_mentoria")
      .select("id, fecha_inicio, fecha_fin, persona:persona_id(id, nombre, apellido, cargo_actual)")
      .eq("mentor_id", personaId)
      .not("fecha_fin", "is", null)
      .order("fecha_fin", { ascending: false })
      .then(({ data }: { data: typeof anteriores | null }) => setAnteriores(data ?? []));
  }, [personaId]);

  // Mentees: más recientes primero; sin fecha al final
  const menteesOrdenados = [...mentees].sort((a, b) =>
    (desdeMentee[b.id] ?? "").localeCompare(desdeMentee[a.id] ?? ""));

  // Historial ordenado de más antiguo a más reciente (sin fecha primero)
  useEffect(() => {
    createAnyClient()
      .from("persona_mentoria")
      .select("id, fecha_inicio, fecha_fin, mentor:mentor_id(id, nombre, apellido, cargo_actual)")
      .eq("persona_id", personaId)
      .order("fecha_inicio", { ascending: true, nullsFirst: true })
      .then(({ data }: { data: Mentoria[] | null }) => setHistorial(data ?? []));
  }, [personaId]);

  // Scroll al hito más reciente
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [historial]);

  // Lista de candidatos: se carga solo al abrir el selector
  useEffect(() => {
    if ((!abierto && !editando) || personas.length) return;
    createAnyClient()
      .from("persona")
      .select("id, nombre, apellido, cargo_actual")
      .eq("activo", true)
      .neq("id", personaId)
      .order("apellido")
      .then(({ data }: { data: PersonaMini[] | null }) => setPersonas(data ?? []));
  }, [abierto, editando, personas.length, personaId]);

  // Cierra la mentoría vigente en `fecha` y (si hay nuevo mentor) abre una nueva desde esa fecha
  async function asignar(nuevo: PersonaMini | null) {
    if (nuevo && nuevo.id === mentor?.id) { setAbierto(false); return; }
    const fecha = fechaInicio || format(new Date(), "yyyy-MM-dd");
    setGuardando(true);
    setError(null);
    const sb = createAnyClient();
    const cierre = await sb.from("persona_mentoria").update({ fecha_fin: fecha }).eq("persona_id", personaId).is("fecha_fin", null);
    const alta = nuevo
      ? await sb.from("persona_mentoria")
          .insert({ persona_id: personaId, mentor_id: nuevo.id, fecha_inicio: fecha })
          .select("id, fecha_inicio, fecha_fin, mentor:mentor_id(id, nombre, apellido, cargo_actual)")
          .single()
      : { data: null, error: null };
    const { error } = await sb.from("persona").update({ mentor_id: nuevo?.id ?? null }).eq("id", personaId);
    setGuardando(false);
    if (cierre.error || alta.error || error) { setError("No se pudo guardar. Intenta nuevamente."); return; }
    setHistorial((prev) => [
      ...prev.map((m) => (m.fecha_fin == null ? { ...m, fecha_fin: fecha } : m)),
      ...(alta.data ? [alta.data as Mentoria] : []),
    ]);
    onMentorChange(nuevo);
    setAbierto(false);
    setBusqueda("");
  }

  function abrirEdicion(m: Mentoria) {
    setError(null);
    setEditando(m);
    setEdMentorId(m.mentor?.id ?? "");
    setEdInicio(m.fecha_inicio ?? "");
    setEdFin(m.fecha_fin ?? "");
  }

  async function guardarEdicion() {
    if (!editando || !edMentorId) { setError("Selecciona un mentor."); return; }
    const actual = editando.fecha_fin == null;
    if (!actual && !edFin) { setError("La fecha de término es obligatoria en mentorías finalizadas."); return; }
    if (edInicio && edFin && edFin < edInicio) { setError("La fecha de término no puede ser anterior al inicio."); return; }
    setGuardando(true);
    setError(null);
    const sb = createAnyClient();
    const { data, error } = await sb.from("persona_mentoria")
      .update({ mentor_id: edMentorId, fecha_inicio: edInicio || null, fecha_fin: actual ? null : edFin })
      .eq("id", editando.id)
      .select("id, fecha_inicio, fecha_fin, mentor:mentor_id(id, nombre, apellido, cargo_actual)")
      .single();
    // Si cambia la persona de la mentoría vigente, se sincroniza persona.mentor_id
    const cambiaVigente = actual && edMentorId !== mentor?.id;
    const sync = cambiaVigente ? await sb.from("persona").update({ mentor_id: edMentorId }).eq("id", personaId) : { error: null };
    setGuardando(false);
    if (error || sync.error || !data) { setError("No se pudo guardar. Intenta nuevamente."); return; }
    const editada = data as Mentoria;
    setHistorial((prev) => prev.map((m) => (m.id === editada.id ? editada : m))
      .sort((a, b) => (a.fecha_inicio ?? "").localeCompare(b.fecha_inicio ?? "")));
    if (cambiaVigente) onMentorChange(editada.mentor);
    setEditando(null);
  }

  async function eliminarMentoria() {
    if (!editando || !confirm("¿Eliminar esta mentoría del historial?")) return;
    const actual = editando.fecha_fin == null;
    const sb = createAnyClient();
    const { error } = await sb.from("persona_mentoria").delete().eq("id", editando.id);
    // Eliminar la vigente deja a la persona sin mentor
    const sync = actual ? await sb.from("persona").update({ mentor_id: null }).eq("id", personaId) : { error: null };
    if (error || sync.error) { setError("No se pudo eliminar. Intenta nuevamente."); return; }
    setHistorial((prev) => prev.filter((m) => m.id !== editando.id));
    if (actual) onMentorChange(null);
    setEditando(null);
  }

  const q = busqueda.trim().toLowerCase();
  // Excluye mentees (evita ciclos mentor ↔ mentee) y filtra por nombre/cargo
  const menteeIds = new Set(mentees.map((m) => m.id));
  const candidatos = personas
    .filter((p) => !menteeIds.has(p.id))
    .filter((p) => !q || `${p.nombre} ${p.apellido} ${p.cargo_actual ?? ""}`.toLowerCase().includes(q));

  return (
    <div>
      <div className={`flex items-center justify-between ${colapsada ? "" : "mb-4"}`}>
        <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-700 tracking-wide uppercase"><Users className="w-4 h-4 text-gray-400" /> Mentores y Mentees</h4>
        {botonColapsar}
      </div>
      {/* Contenido colapsable (los modales quedan fuera para no desmontarse) */}
      {!colapsada && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Línea temporal de mentores (antiguo → reciente) */}
        <div className="md:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-[#555]">Historial de mentores</p>
            <div className="flex items-center gap-2">
              {mentor && (
                <button
                  onClick={() => { if (confirm("¿Finalizar la mentoría actual sin asignar un nuevo mentor?")) asignar(null); }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#888] hover:bg-[#f5f5f5] transition-colors"
                >
                  Finalizar actual
                </button>
              )}
              <button
                onClick={() => { setFechaInicio(format(new Date(), "yyyy-MM-dd")); setAbierto(true); }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#555] hover:bg-[#f5f5f5] transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" /> {mentor ? "Cambiar mentor" : "Asignar Mentor"}
              </button>
            </div>
          </div>
          {error && !abierto && <p className="text-xs text-red-500 mb-2">{error}</p>}
          {historial.length === 0 ? (
            mentor ? (
              // Mentor vigente sin registro histórico (antes de esta funcionalidad)
              <div className="max-w-xs"><TarjetaPersona p={mentor} /></div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#e8e8e8] bg-[#fafafa] px-4 py-4 text-center">
                <p className="text-[12px] text-[#aaa]">Sin mentores asignados aún.</p>
              </div>
            )
          ) : (
            <div ref={scrollRef} className="flex flex-row overflow-x-auto gap-4 pb-2">
              {historial.map((m) => {
                const actual = m.fecha_fin == null;
                const p = m.mentor;
                const color = CARGO_COLORS[p?.cargo_actual ?? ""] ?? CARGO_COLOR_DEFAULT;
                return (
                  <div
                    key={m.id}
                    className="group relative shrink-0 w-60 border rounded-lg p-4 bg-white/50"
                    style={{ borderColor: actual ? "#93c5fd" : "#e8e8e8", boxShadow: actual ? "0 0 0 3px rgba(59,130,246,0.10)" : "none" }}
                  >
                    <button
                      onClick={() => abrirEdicion(m)}
                      title="Editar mentoría"
                      className="absolute top-2 right-2 p-1 rounded text-[#888] hover:text-[#1a1a1a] hover:bg-[#f5f5f5] opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex items-center gap-3 pr-5">
                      <div className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: color }}>
                        {p ? getIniciales(p.nombre, p.apellido) : "?"}
                      </div>
                      <div className="min-w-0">
                        {p ? (
                          <Link href={`/personas/${p.id}`} className="block text-sm font-medium text-[#1a1a1a] truncate hover:underline">{p.nombre} {p.apellido}</Link>
                        ) : (
                          <p className="text-sm text-[#aaa]">Persona eliminada</p>
                        )}
                        <p className="text-[11px] truncate" style={{ color }}>{p?.cargo_actual ?? "Sin cargo"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-3">
                      <span className="text-[11px] text-[#60a5fa] font-medium capitalize">
                        {fmtFecha(m.fecha_inicio)} → {actual ? "Presente" : fmtFecha(m.fecha_fin)}
                      </span>
                      {actual && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white uppercase tracking-wide">Actual</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Mentees actuales */}
        <div className="md:col-span-2">
          <p className="text-[11px] font-semibold text-[#555] mb-2">
            Mentees actuales {mentees.length > 0 && <span className="text-[#aaa] font-normal">({mentees.length})</span>}
          </p>
          {mentees.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#e8e8e8] bg-[#fafafa] px-4 py-4 text-center">
              <p className="text-[12px] text-[#aaa]">No es mentor/a de nadie aún.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {menteesOrdenados.map((m) => <TarjetaPersona key={m.id} p={m} desde={desdeMentee[m.id] ?? null} />)}
            </div>
          )}
        </div>

        {/* Mentees anteriores (mentorías finalizadas, estilo atenuado) */}
        {anteriores.length > 0 && (
          <div className="md:col-span-2">
            <p className="text-[11px] font-semibold text-[#aaa] mb-2">
              Mentees anteriores <span className="font-normal">({anteriores.length})</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {anteriores.map((m) => m.persona && (
                <div key={m.id} className="flex items-center gap-3 border border-[#f0f0f0] rounded-lg p-3 bg-[#fafafa] opacity-75">
                  <div className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white bg-[#c0c0c0]">
                    {getIniciales(m.persona.nombre, m.persona.apellido)}
                  </div>
                  <div className="min-w-0">
                    <Link href={`/personas/${m.persona.id}`} className="block text-sm text-[#666] truncate hover:underline">
                      {m.persona.nombre} {m.persona.apellido}
                    </Link>
                    <p className="text-[11px] text-[#999] truncate">{m.persona.cargo_actual ?? "Sin cargo"}</p>
                    <p className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5 capitalize">
                      <CalendarDays className="w-3 h-3" /> {fmtFecha(m.fecha_inicio)} → {fmtFecha(m.fecha_fin)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Editar mentoría (persona y fechas) */}
      <Modal
        open={!!editando}
        onClose={() => { setEditando(null); setError(null); }}
        title="Editar mentoría"
        footer={
          <div className="flex items-center justify-between w-full">
            <button onClick={eliminarMentoria} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Eliminar
            </button>
            <div className="flex gap-2">
              <button onClick={() => { setEditando(null); setError(null); }} className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#888] hover:bg-[#f5f5f5] transition-colors">
                Cancelar
              </button>
              <button onClick={guardarEdicion} disabled={guardando} className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a2e] text-white hover:bg-[#2d2d4e] transition-colors disabled:opacity-50">
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        }
      >
        {editando && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[11px] text-[#888]">Mentor</span>
              <select
                value={edMentorId}
                onChange={(e) => setEdMentorId(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg border border-[#e8e8e8] outline-none focus:border-[#1a1a2e] bg-white"
              >
                <option value="">Seleccionar…</option>
                {/* Incluye al mentor actual de la mentoría aunque no esté en la lista cargada */}
                {editando.mentor && !personas.some((x) => x.id === editando.mentor!.id) && (
                  <option value={editando.mentor.id}>{editando.mentor.nombre} {editando.mentor.apellido}</option>
                )}
                {personas.filter((x) => !menteeIds.has(x.id)).map((x) => (
                  <option key={x.id} value={x.id}>{x.nombre} {x.apellido}{x.cargo_actual ? ` · ${x.cargo_actual}` : ""}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[11px] text-[#888]">Fecha de inicio</span>
                <input type="date" value={edInicio} onChange={(e) => setEdInicio(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-[#e8e8e8] outline-none focus:border-[#1a1a2e]" />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-[#888]">Fecha de término</span>
                {editando.fecha_fin == null ? (
                  <p className="text-sm px-3 py-2 text-[#aaa]">Presente (vigente)</p>
                ) : (
                  <input type="date" value={edFin} onChange={(e) => setEdFin(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-[#e8e8e8] outline-none focus:border-[#1a1a2e]" />
                )}
              </label>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}
      </Modal>

      {/* Selector de mentor */}
      <Modal open={abierto} onClose={() => { setAbierto(false); setBusqueda(""); }} title="Seleccionar mentor">
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] text-[#888]">Fecha de inicio (la mentoría actual finaliza ese día)</span>
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border border-[#e8e8e8] outline-none focus:border-[#1a1a2e]"
            />
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#aaa]" />
            <input
              autoFocus
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o cargo…"
              className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-[#e8e8e8] outline-none focus:border-[#1a1a2e]"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <ul className="max-h-80 overflow-y-auto divide-y divide-[#f0f0f0]">
            {candidatos.map((p) => (
              <li key={p.id}>
                <button
                  disabled={guardando}
                  onClick={() => asignar(p)}
                  className={`w-full flex items-center gap-3 px-2 py-2 text-left rounded hover:bg-[#f5f5f5] disabled:opacity-50 ${p.id === mentor?.id ? "bg-[#f0f0f0]" : ""}`}
                >
                  <span
                    className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ background: CARGO_COLORS[p.cargo_actual ?? ""] ?? CARGO_COLOR_DEFAULT }}
                  >
                    {getIniciales(p.nombre, p.apellido)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-[#1a1a1a] truncate">{p.nombre} {p.apellido}</span>
                    <span className="block text-[11px] text-[#888] truncate">{p.cargo_actual ?? "Sin cargo"}</span>
                  </span>
                </button>
              </li>
            ))}
            {candidatos.length === 0 && <li className="py-4 text-center text-xs text-[#aaa]">Sin resultados.</li>}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
