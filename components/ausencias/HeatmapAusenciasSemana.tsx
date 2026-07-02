"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Plus, ChevronDown, ChevronRight, RotateCcw, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/Modal";
import { createClient } from "@/lib/supabase/client";
import {
  fetchAusenciasMes,
  crearAusencia,
  eliminarAusencia,
  COLOR_AUSENCIA,
  isHoliday,
  type FilaPersona,
  type CeldaAusencia,
  type PersonaConSeniority,
} from "@/lib/queries/ausencias";
import type { TipoAusencia } from "@/lib/types/database";
import { useTiposAusencia } from "@/lib/hooks/useTiposAusencia";
import { PopoverPersona } from "./PopoverPersona";

const MESES_CORTO = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DOW_LETRA   = ["L","M","X","J","V"];

// ── Helpers ───────────────────────────────────────────────────
function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // ajusta a lunes
  const s = new Date(d);
  s.setDate(d.getDate() + diff);
  s.setHours(0, 0, 0, 0);
  return s;
}

function getWeekDays(d: Date): string[] {
  const start = getWeekStart(d);
  return Array.from({ length: 5 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

function pctStyle(pct: number): { bg: string; text: string } | null {
  if (pct === 0)  return null;
  if (pct <= 25)  return { bg: "#ecfdf5", text: "#065f46" };
  if (pct <= 50)  return { bg: "#fffbeb", text: "#92400e" };
  if (pct <= 75)  return { bg: "#fff7ed", text: "#9a3412" };
  return           { bg: "#fef2f2", text: "#991b1b" };
}

// ── CeldaTooltip — portal para evitar clip por overflow ───────
interface TooltipProps {
  celda: CeldaAusencia;
  persona: PersonaConSeniority;
  fecha: string;
  onEliminar: (id: string) => void;
  eliminando: boolean;
  onEditar: () => void;
  onCerrar: () => void;
  anchorRect: DOMRect;
  readOnly?: boolean;
}
function CeldaTooltip({ celda, persona, fecha, onEliminar, eliminando, onEditar, onCerrar, anchorRect, readOnly = false, tiposDinamicos = [] }: TooltipProps & { tiposDinamicos?: { id: string; label: string; color_bg: string; color_text: string }[] }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const din = tiposDinamicos.find((t) => t.id === celda.tipo);
  const est = COLOR_AUSENCIA[celda.tipo as TipoAusencia];
  const cfg = din ? { bg: din.color_bg, text: din.color_text, label: din.label } : est ?? { bg: "#9ca3af", text: "#fff", label: celda.tipo };
  const labelFecha = new Date(fecha + "T00:00:00").toLocaleDateString("es-CL", {
    weekday: "long", day: "numeric", month: "long",
  });
  return createPortal(
    <>
      <div className="w-52 rounded-xl bg-white border border-[#e8e8e8] shadow-lg p-3 text-left pointer-events-auto"
        style={{ position: "fixed", zIndex: 9999, top: anchorRect.top, left: anchorRect.left + anchorRect.width / 2, transform: "translate(-50%, calc(-100% - 8px))" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: cfg.bg }}>{cfg.label}</span>
          <div className="flex items-center gap-1">
            {!readOnly && <button onClick={onEditar} title="Editar" className="text-[#bbb] hover:text-[#4a90e2] transition-colors"><Pencil className="w-3 h-3" /></button>}
            {!readOnly && <button onClick={() => setConfirmOpen(true)} disabled={eliminando} title="Eliminar" className="text-[#bbb] hover:text-red-500 transition-colors">
              {eliminando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            </button>}
            <button onClick={onCerrar} className="text-[#bbb] hover:text-[#555] transition-colors"><X className="w-3 h-3" /></button>
          </div>
        </div>
        <p className="text-[12px] font-semibold text-[#1a1a1a] leading-tight">{persona.nombre} {persona.apellido}</p>
        {persona.cargo_actual && <p className="text-[10px] text-[#888] mt-0.5">{persona.cargo_actual}</p>}
        <p className="text-[10px] text-[#999] mt-1.5 capitalize">{labelFecha}</p>
        {celda.descripcion && (
          <p className="text-[11px] text-[#555] mt-1.5 leading-snug border-t border-[#f0f0f0] pt-1.5">{celda.descripcion}</p>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); onEliminar(celda.ausencia_id); }}
        title="Eliminar ausencia"
        message="¿Estás seguro de que deseas eliminar esta ausencia? Esta acción es irreversible."
        confirmLabel="Confirmar eliminación"
        loading={eliminando}
      />
    </>,
    document.body
  );
}

// ── Modal nueva / editar ausencia ─────────────────────────────
interface ModalProps {
  personas: PersonaConSeniority[];
  fechaInicial?: string;
  personaInicial?: string;
  editarId?: string;        // si está presente → modo edición
  onClose: () => void;
  onGuardado: () => void;
}
function ModalAusencia({ personas, fechaInicial, personaInicial, editarId, onClose, onGuardado }: ModalProps) {
  const modoEdicion = !!editarId;
  const [personaId,   setPersonaId]   = useState(personaInicial ?? "");
  const [tipo,        setTipo]        = useState<string>("vacaciones_confirmadas");
  const [fechaInicio, setFechaInicio] = useState(fechaInicial ?? "");
  const [fechaFin,    setFechaFin]    = useState(fechaInicial ?? "");
  const [descripcion, setDescripcion] = useState("");
  const [guardando,   setGuardando]   = useState(false);
  const [cargandoEdit,setCargandoEdit]= useState(modoEdicion);

  // Gestión dinámica de tipos
  const { tipos: tiposDinamicos, crearTipo, eliminarTipo } = useTiposAusencia();
  const [nuevoTipoInput,    setNuevoTipoInput]    = useState("");
  const [nuevoTipoColor,    setNuevoTipoColor]    = useState("#f43f5e");
  const [mostrarNuevoTipo,  setMostrarNuevoTipo]  = useState(false);
  const [tipoMsgError,      setTipoMsgError]      = useState<string | null>(null);
  const [tipoMsgConfirm,    setTipoMsgConfirm]    = useState<string | null>(null);

  const PALETA_PICKER = [
    "#f43f5e","#ef4444","#f97316","#f59e0b","#eab308",
    "#84cc16","#22c55e","#10b981","#14b8a6","#06b6d4",
    "#0ea5e9","#3b82f6","#6366f1","#8b5cf6","#a855f7",
    "#d946ef","#ec4899","#9ca3af","#78716c","#92400e",
  ];
  const cfgTipo = tiposDinamicos.find((t) => t.id === tipo);
  const colorPreviewDinamico = cfgTipo?.color_bg ?? COLOR_AUSENCIA[tipo as TipoAusencia]?.bg ?? "#9ca3af";

  async function handleCrearTipo() {
    if (!nuevoTipoInput.trim()) return;
    const nuevo = await crearTipo(nuevoTipoInput, nuevoTipoColor);
    if (nuevo) { setTipo(nuevo.id); setNuevoTipoInput(""); setNuevoTipoColor("#f43f5e"); setMostrarNuevoTipo(false); }
    else setTipoMsgError("Ya existe un tipo con ese nombre.");
  }
  async function handleEliminarTipo() {
    setTipoMsgError(null); setTipoMsgConfirm(null);
    const { ok, count } = await eliminarTipo(tipo);
    if (!ok) setTipoMsgError(`No se puede eliminar: hay ${count} ausencia(s) con este tipo.`);
    else { setTipoMsgConfirm("Tipo eliminado."); setTipo(tiposDinamicos[0]?.id ?? "otro"); }
  }
  const [error,       setError]       = useState<string | null>(null);
  const supabase = createClient();

  // En modo edición: carga datos previos
  useEffect(() => {
    if (!editarId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from("ausencia").select("persona_id,tipo,fecha_inicio,fecha_fin,descripcion")
      .eq("id", editarId).single().then(({ data }: { data: any }) => {
        if (data) {
          setPersonaId(data.persona_id);
          setTipo(data.tipo as TipoAusencia);
          setFechaInicio(data.fecha_inicio);
          setFechaFin(data.fecha_fin);
          setDescripcion(data.descripcion ?? "");
        }
        setCargandoEdit(false);
      });
  }, [editarId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGuardar() {
    if (!modoEdicion && !personaId) { setError("Selecciona una persona."); return; }
    if (!fechaInicio || !fechaFin)  { setError("Las fechas son obligatorias."); return; }
    if (fechaFin < fechaInicio)     { setError("Fecha fin no puede ser anterior al inicio."); return; }
    setGuardando(true);
    if (modoEdicion) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from("ausencia")
        .update({ tipo, fecha_inicio: fechaInicio, fecha_fin: fechaFin, descripcion: descripcion || null })
        .eq("id", editarId);
      setGuardando(false);
      if (err) { setError((err as { message: string }).message); return; }
    } else {
      const { error: err } = await crearAusencia(supabase, {
        persona_id: personaId, tipo: tipo as any,
        fecha_inicio: fechaInicio, fecha_fin: fechaFin,
        descripcion: descripcion || undefined,
      });
      setGuardando(false);
      if (err) { setError(err); return; }
    }
    onGuardado();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl border border-[#e8e8e8] shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
          <h2 className="text-[14px] font-bold text-[#1a1a1a]">{modoEdicion ? "Editar ausencia" : "Nueva ausencia"}</h2>
          <button onClick={onClose} className="text-[#bbb] hover:text-[#555] transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {cargandoEdit ? (
          <div className="flex items-center justify-center py-10 gap-2 text-[#888]">
            <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            {/* Persona */}
            <div>
              <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">Persona</label>
              {modoEdicion ? (
                <div className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#555] bg-[#f5f5f5]">
                  {personas.find(p => p.id === personaId)?.nombre ?? "—"} {personas.find(p => p.id === personaId)?.apellido ?? ""}
                </div>
              ) : (
                <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}
                  className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] bg-white focus:outline-none focus:border-[#1a1a1a]">
                  <option value="">Seleccionar persona...</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre} {p.apellido}{p.cargo_actual ? ` — ${p.cargo_actual}` : ""}</option>
                  ))}
                </select>
              )}
            </div>
            {/* Tipo — dinámico */}
            <div>
              <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">Tipo</label>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: colorPreviewDinamico }} />
                <select value={tipo} onChange={(e) => { setTipoMsgError(null); setTipoMsgConfirm(null); setTipo(e.target.value); }}
                  className="flex-1 border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] bg-white focus:outline-none focus:border-[#1a1a1a]">
                  {tiposDinamicos.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex gap-3 mt-1.5 pl-5">
                <button type="button" onClick={() => { setMostrarNuevoTipo((v) => !v); setTipoMsgError(null); setTipoMsgConfirm(null); }}
                  className="text-[11px] text-[#4a90e2] hover:underline">+ Nuevo tipo</button>
                <button type="button" onClick={handleEliminarTipo}
                  className="text-[11px] text-red-400 hover:underline">🗑️ Eliminar tipo</button>
              </div>
              {mostrarNuevoTipo && (
                <div className="mt-1.5 pl-5 space-y-1.5">
                  <div className="flex gap-2">
                    <span className="w-7 h-7 rounded flex-shrink-0 border border-white ring-1 ring-gray-200" style={{ background: nuevoTipoColor }} />
                    <input type="text" value={nuevoTipoInput} onChange={(e) => setNuevoTipoInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCrearTipo()}
                      placeholder="Nombre del nuevo tipo..."
                      className="flex-1 border border-[#e0e0e0] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[#4a90e2]" />
                    <button type="button" onClick={handleCrearTipo}
                      className="text-[11px] bg-[#4a90e2] text-white rounded px-2 py-1 hover:bg-[#357abd] whitespace-nowrap">Añadir</button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {PALETA_PICKER.map((c) => (
                      <button key={c} type="button" onClick={() => setNuevoTipoColor(c)}
                        className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                        style={{ background: c, outline: nuevoTipoColor === c ? `2px solid ${c}` : "none", outlineOffset: 2 }}
                        title={c} />
                    ))}
                  </div>
                </div>
              )}
              {tipoMsgError   && <p className="text-[11px] text-red-500 mt-1 pl-5">{tipoMsgError}</p>}
              {tipoMsgConfirm && <p className="text-[11px] text-green-600 mt-1 pl-5">{tipoMsgConfirm}</p>}
            </div>
            {/* Fechas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">Desde</label>
                <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)}
                  className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] focus:outline-none focus:border-[#1a1a1a]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">Hasta</label>
                <input type="date" value={fechaFin} min={fechaInicio} onChange={(e) => setFechaFin(e.target.value)}
                  className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] focus:outline-none focus:border-[#1a1a1a]" />
              </div>
            </div>
            {/* Nota */}
            <div>
              <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">Nota <span className="font-normal normal-case">(opcional)</span></label>
              <input type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Ej: vacaciones de invierno"
                className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] placeholder-[#ccc] focus:outline-none focus:border-[#1a1a1a]" />
            </div>
          </div>
        )}

        {error && <p className="px-5 pb-2 text-[12px] text-red-500">{error}</p>}
        <div className="flex gap-2 px-5 py-4 border-t border-[#f0f0f0]">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#e0e0e0] text-[13px] text-[#555] hover:bg-[#f5f5f5] font-medium">Cancelar</button>
          <button onClick={handleGuardar} disabled={guardando || cargandoEdit}
            className="flex-1 py-2 rounded-lg bg-[#1a1a1a] hover:bg-[#333] text-[13px] font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-1.5">
            {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {guardando ? "Guardando..." : modoEdicion ? "Guardar cambios" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────
const CARGOS_VISIBLES_AYSR = ["Consultor de Proyectos", "Consultor Proyecto", "Consultor Analista", "Consultor Trainee"];

interface Props {
  selectedDate: Date;
  externalModalOpen?: boolean;
  onExternalModalClose?: () => void;
  readOnly?: boolean;
  rolActual?: string | null;
}

export function HeatmapAusenciasSemana({ selectedDate, externalModalOpen = false, onExternalModalClose, readOnly = false, rolActual }: Props) {
  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);
  const { tipos: tiposDinamicos } = useTiposAusencia();
  const ocultarPctResumen = rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador";

  // Resuelve color de tipo dinámico > estático > fallback
  function colorDeTipo(tipo: string): { bg: string; label: string } {
    const din = tiposDinamicos.find((t) => t.id === tipo);
    if (din) return { bg: din.color_bg, label: din.label };
    const est = COLOR_AUSENCIA[tipo as TipoAusencia];
    if (est) return { bg: est.bg, label: est.label };
    return { bg: "#9ca3af", label: tipo };
  }

  const [filas,    setFilas]    = useState<FilaPersona[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const [tooltip,   setTooltip]   = useState<{ personaId: string; fecha: string; rect: DOMRect } | null>(null);
  const [eliminando,setEliminando]= useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<{ persona_id: string; tipo: TipoAusencia; fecha_inicio: string; fecha_fin: string; descripcion: string | null }[]>([]);
  const [undoing,   setUndoing]   = useState(false);

  const [modalOpen,    setModalOpen]    = useState(false);
  const [modalFecha,   setModalFecha]   = useState<string | undefined>();
  const [modalPersona, setModalPersona] = useState<string | undefined>();
  const [editarId,     setEditarId]     = useState<string | undefined>();

  const [cargoColapsados,   setCargoColapsados]   = useState<Set<string>>(new Set());
  const [personaColapsados, setPersonaColapsados] = useState<Set<string>>(new Set());

  // Popover de resumen de ausencias — mismo componente que usan las vistas mes/trimestre
  const [popoverPersona, setPopoverPersona] = useState<PersonaConSeniority | null>(null);

  const supabase = createClient();

  // Sincronizar modal externo (botón "+ Nueva ausencia" del header)
  useEffect(() => {
    if (externalModalOpen) { setModalFecha(undefined); setModalPersona(undefined); setEditarId(undefined); setModalOpen(true); }
  }, [externalModalOpen]);

  // Carga datos — maneja semanas que cruzan dos meses
  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    const start = new Date(weekDays[0] + "T00:00:00");
    const end   = new Date(weekDays[4] + "T00:00:00");
    const y1 = start.getFullYear(), m1 = start.getMonth() + 1;
    const y2 = end.getFullYear(),   m2 = end.getMonth() + 1;
    const isSameMonth = y1 === y2 && m1 === m2;

    const [r1, r2] = await Promise.all([
      fetchAusenciasMes(supabase, y1, m1),
      isSameMonth ? Promise.resolve(null) : fetchAusenciasMes(supabase, y2, m2),
    ]);

    setCargando(false);
    if (r1.error) { setError(r1.error); return; }

    // Fusiona días de ambos meses por persona
    let merged = r1.filas;
    if (r2 && !r2.error) {
      const byId = new Map(merged.map((f) => [f.persona.id, f]));
      for (const f2 of r2.filas) {
        const ex = byId.get(f2.persona.id);
        byId.set(f2.persona.id, ex
          ? { ...ex, dias: { ...ex.dias, ...f2.dias } }
          : f2
        );
      }
      merged = Array.from(byId.values());
    }
    setFilas(merged);
  }, [weekDays, rolActual]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  // Agrupar por cargo. Para AySr los 3 cargos visibles se unifican bajo "Consultores".
  const grupos = useMemo(() => {
    const map = new Map<string, FilaPersona[]>();
    for (const fila of filas) {
      const cargoReal = fila.persona.cargo_actual ?? "Sin cargo";
      const cargoKey = rolActual === "AySr" && CARGOS_VISIBLES_AYSR.includes(cargoReal)
        ? "Consultores"
        : cargoReal;
      if (!map.has(cargoKey)) map.set(cargoKey, []);
      map.get(cargoKey)!.push(fila);
    }
    const entries = Array.from(map.entries());
    // Dentro de cada grupo: más antiguo primero (fecha_ingreso menor)
    for (const [, grupo] of entries) {
      grupo.sort((a, b) => {
        const fa = a.persona.fecha_ingreso ?? "9999-12-31";
        const fb = b.persona.fecha_ingreso ?? "9999-12-31";
        return fa.localeCompare(fb);
      });
    }
    return entries;
  }, [filas, rolActual]);

  const personas = useMemo(() => filas.map(f => f.persona), [filas]);

  function toggleCargo(c: string)   { setCargoColapsados(p => { const s = new Set(p); s.has(c)  ? s.delete(c)  : s.add(c);  return s; }); }
  function togglePersona(id: string){ setPersonaColapsados(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; }); }
  function colapsarTodo() { setCargoColapsados(new Set(grupos.map(([c]) => c))); }
  function expandirTodo()  { setCargoColapsados(new Set()); }

  async function handleEliminar(ausenciaId: string) {
    const { data } = await supabase.from("ausencia")
      .select("persona_id, tipo, fecha_inicio, fecha_fin, descripcion")
      .eq("id", ausenciaId).single();
    if (data) setUndoStack(s => [...s, data as { persona_id: string; tipo: TipoAusencia; fecha_inicio: string; fecha_fin: string; descripcion: string | null }]);
    setEliminando(ausenciaId); setTooltip(null);
    await eliminarAusencia(supabase, ausenciaId);
    setEliminando(null);
    cargar();
  }

  async function handleUndo() {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setUndoing(true);
    await crearAusencia(supabase, { persona_id: last.persona_id, tipo: last.tipo, fecha_inicio: last.fecha_inicio, fecha_fin: last.fecha_fin, descripcion: last.descripcion ?? undefined });
    setUndoStack(s => s.slice(0, -1));
    setUndoing(false);
    cargar();
  }

  // Mes "primario" de la semana (miércoles) para mostrar mes en header solo si difiere
  const mesPrimario = new Date(weekDays[2] + "T00:00:00").getMonth();

  // ── Estados de carga / error / vacío ─────────────────────────
  if (cargando) return (
    <div className="flex-1 flex items-center justify-center text-[#888] gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
    </div>
  );
  if (error) return <div className="flex-1 flex items-center justify-center text-red-500 text-sm">Error: {error}</div>;
  if (!filas.length) return <div className="flex-1 flex items-center justify-center text-[#999] text-sm">No hay personas activas.</div>;

  // ── Render ────────────────────────────────────────────────────
  return (
    <>
    <div className="flex-1 overflow-auto">
      {/* table-fixed + colgroup → 5 columnas iguales en el espacio disponible */}
      <table className="border-collapse w-full table-fixed text-[12px]">
        <colgroup>
          <col style={{ width: 140 }} />
          {weekDays.map((d) => <col key={d} />)}
        </colgroup>

        <thead className="sticky top-0 z-20">
          <tr>
            {/* Cabecera PERSONA con controles fusionados */}
            <th className="sticky left-0 z-30 bg-[#fafafa] border-b border-r border-[#ebebeb] px-2 py-0.5 text-left text-[10px] font-semibold text-[#888] uppercase tracking-wide">
              <div className="flex items-center justify-between gap-1">
                <span>Persona</span>
                <div className="flex items-center gap-1">
                  {!readOnly && <button onClick={handleUndo} disabled={!undoStack.length || undoing} title="Deshacer"
                    className="p-0.5 rounded hover:bg-[#e8e8e8] text-[#bbb] hover:text-[#555] disabled:opacity-30 transition-colors">
                    {undoing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  </button>}
                  <button onClick={cargoColapsados.size >= grupos.length ? expandirTodo : colapsarTodo}
                    title={cargoColapsados.size >= grupos.length ? "Expandir todo" : "Colapsar todo"}
                    className="p-0.5 rounded hover:bg-[#e8e8e8] text-[#bbb] hover:text-[#555] transition-colors">
                    {cargoColapsados.size >= grupos.length ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </th>

            {/* Cabecera de cada día (L/M/X/J/V + número + mes si cruza) */}
            {weekDays.map((iso, i) => {
              const d = new Date(iso + "T00:00:00");
              const esFeriado = isHoliday(iso);
              const mes = d.getMonth();
              return (
                <th key={iso}
                  className={`border-b border-[#ebebeb] px-1 py-1 text-center ${esFeriado ? "bg-gray-200" : "bg-[#fafafa]"}`}
                  title={esFeriado ? "Feriado" : undefined}
                >
                  <div className={`text-[9px] font-medium leading-none ${esFeriado ? "text-gray-400" : "text-[#bbb]"}`}>{DOW_LETRA[i]}</div>
                  <div className={`text-[12px] font-bold leading-tight ${esFeriado ? "text-gray-400" : "text-[#555]"}`}>{d.getDate()}</div>
                  {/* Muestra mes solo si la semana cruza de mes */}
                  {mes !== mesPrimario && (
                    <div className="text-[8px] text-[#bbb] leading-none">{MESES_CORTO[mes]}</div>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {grupos.map(([cargo, filasGrupo]) => {
            const estaColapsadoCargo = cargoColapsados.has(cargo);
            return (
              <React.Fragment key={cargo}>

                {/* ── Fila de cargo (nivel 1) ── */}
                <tr className="bg-[#f0f0f0]">
                  <td className="sticky left-0 z-10 bg-[#f0f0f0] border-r border-[#ddd] px-2 py-1.5">
                    <button onClick={() => toggleCargo(cargo)} className="flex items-center gap-1.5 w-full text-left hover:opacity-70 transition-opacity">
                      {estaColapsadoCargo
                        ? <ChevronRight className="w-3 h-3 text-[#777] flex-shrink-0" />
                        : <ChevronDown  className="w-3 h-3 text-[#777] flex-shrink-0" />}
                      <span className="text-[10px] font-bold text-[#444] uppercase tracking-wide truncate">{cargo}</span>
                      <span className="text-[9px] text-[#aaa] ml-1 flex-shrink-0">· {filasGrupo.length}</span>
                    </button>
                  </td>
                  {weekDays.map((iso) => (
                    <td key={iso} className={`py-1 px-1 ${isHoliday(iso) ? "bg-gray-200" : "bg-[#f0f0f0]"}`} />
                  ))}
                </tr>

                {/* ── Filas de personas (nivel 2) ── */}
                {!estaColapsadoCargo && filasGrupo.map((fila, rowIdx) => {
                  const estaColapsadaPersona = personaColapsados.has(fila.persona.id);
                  return (
                    <tr key={fila.persona.id} className={rowIdx % 2 === 0 ? "bg-white" : "bg-[#fafafa]"}>

                      {/* Columna nombre */}
                      <td className="sticky left-0 z-10 bg-inherit border-r border-[#ebebeb] px-1.5 py-0">
                        <div className="flex items-center gap-1">
                          {fila.persona.is_leverager && !(rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador" || rolActual === "Desarrollo") && (
                            <span className="w-4 h-4 rounded-full bg-[#3b5bdb] flex-shrink-0 flex items-center justify-center text-white font-black leading-none" style={{ fontSize: 8 }}>A</span>
                          )}
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setPopoverPersona(fila.persona); }}
                              className="text-[11px] font-medium leading-tight text-[#1a1a1a] truncate block w-full text-left cursor-pointer hover:underline hover:text-blue-600 transition-colors"
                              title="Ver resumen de ausencias"
                            >
                              {fila.persona.nombre} {fila.persona.apellido}
                            </button>
                            {!estaColapsadaPersona && fila.persona.cargo_actual && (
                              <p className="text-[9px] leading-none text-[#999] truncate">{fila.persona.cargo_actual}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Celdas de días */}
                      {weekDays.map((iso) => {
                        const celdaReal = fila.dias[iso];
                        const celda     = ocultarPctResumen && celdaReal?.tipo === "vacaciones_por_confirmar" ? null : celdaReal;
                        const esFeriado = isHoliday(iso);
                        const isActive  = tooltip?.personaId === fila.persona.id && tooltip?.fecha === iso;
                        const cfg       = celda ? colorDeTipo(celda.tipo) : null;

                        // Vista colapsada: solo barra de color, sin interacción
                        if (estaColapsadaPersona) {
                          return (
                            <td key={iso} className={`py-px px-px border-b border-[#f5f5f5] ${esFeriado ? "bg-gray-200" : ""}`}
                              title={cfg?.label}>
                              {celda
                                ? <div className="w-full h-2.5 rounded-sm" style={{ background: cfg?.bg }} />
                                : esFeriado
                                  ? <div className="w-full h-2.5 rounded-sm bg-gray-400 opacity-40" />
                                  : <div className="w-full h-2.5" />}
                            </td>
                          );
                        }

                        // Vista expandida: celda interactiva con label
                        return (
                          <td key={iso} className={`py-0.5 px-0.5 border-b border-[#f5f5f5] relative ${esFeriado ? "bg-gray-200" : ""}`}>
                            {celda && cfg ? (
                              <div className="relative">
                                <button type="button"
                                  onClick={(e) => {
                                    if (isActive) { setTooltip(null); return; }
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    setTooltip({ personaId: fila.persona.id, fecha: iso, rect });
                                  }}
                                  className="w-full h-5 rounded transition-opacity hover:opacity-80 flex items-center justify-center px-1"
                                  style={{ background: cfg.bg }}
                                  title={cfg.label}
                                >
                                  {/* Texto visible gracias al mayor ancho de columna */}
                                  <span className="text-[9px] font-semibold text-white leading-none truncate select-none">
                                    {cfg.label.split(" ")[0]}
                                  </span>
                                </button>
                                {isActive && (
                                  <CeldaTooltip celda={celda} persona={fila.persona} fecha={iso}
                                    onEliminar={handleEliminar} eliminando={eliminando === celda.ausencia_id}
                                    onEditar={() => { setEditarId(celda.ausencia_id); setModalOpen(true); setTooltip(null); }}
                                    onCerrar={() => setTooltip(null)}
                                    anchorRect={tooltip!.rect}
                                    readOnly={readOnly}
                                    tiposDinamicos={tiposDinamicos}
                                  />
                                )}
                              </div>
                            ) : esFeriado ? (
                              <div className="w-full h-5 rounded bg-gray-400 opacity-40" title="Feriado" />
                            ) : (
                              !readOnly && (
                              <button type="button"
                                className="w-full h-5 rounded hover:bg-[#f0f0f0] transition-colors group flex items-center justify-center"
                                onClick={() => { setModalPersona(fila.persona.id); setModalFecha(iso); setEditarId(undefined); setModalOpen(true); }}
                                title="Agregar ausencia"
                              >
                                <Plus className="w-2 h-2 text-[#ddd] group-hover:text-[#bbb] transition-colors" />
                              </button>
                              )
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* ── Fila resumen del cargo ── */}
                {!estaColapsadoCargo && (
                  <tr className="bg-[#f4f4f4] border-t border-b border-[#e0e0e0]">
                    <td className="sticky left-0 z-10 bg-[#f4f4f4] border-r border-[#e0e0e0] px-2 py-0.5">
                      <div className="text-[10px] font-bold text-[#555] uppercase tracking-wide truncate">Resumen · {cargo}</div>
                      <div className="text-[9px] text-[#999]">{filasGrupo.length} {filasGrupo.length === 1 ? "persona" : "personas"}</div>
                    </td>
                    {weekDays.map((iso) => {
                      const ausentes = filasGrupo.filter(f => f.dias[iso] != null).length;
                      const pct      = filasGrupo.length > 0 ? Math.round((ausentes / filasGrupo.length) * 100) : 0;
                      const estilo   = pctStyle(pct);
                      return (
                        <td key={iso} className="px-0.5 py-0.5 text-center"
                          title={ocultarPctResumen ? undefined : (pct > 0 ? `${ausentes}/${filasGrupo.length} ausentes (${pct}%)` : "Sin ausencias")}>
                          {ocultarPctResumen ? (
                            <div className="w-full h-3 rounded" style={{ background: "#f4f4f4" }} />
                          ) : estilo ? (
                            <div className="w-full h-3 rounded flex items-center justify-center" style={{ background: estilo.bg }}>
                              <span className="text-[8px] font-bold leading-none" style={{ color: estilo.text }}>{pct}%</span>
                            </div>
                          ) : <div className="w-full h-3" />}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Modal nueva / editar ausencia */}
    {modalOpen && (
      <ModalAusencia
        personas={personas}
        fechaInicial={modalFecha}
        personaInicial={modalPersona}
        editarId={editarId}
        onClose={() => { setModalOpen(false); setEditarId(undefined); onExternalModalClose?.(); }}
        onGuardado={cargar}
      />
    )}

    {/* Overlay para cerrar tooltip al clicar fuera */}
    {tooltip && <div className="fixed inset-0 z-40" onClick={() => setTooltip(null)} />}

    {popoverPersona && (
      <PopoverPersona persona={popoverPersona} onClose={() => setPopoverPersona(null)} />
    )}
    </>
  );
}
