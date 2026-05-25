"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Plus, ChevronDown, ChevronRight, Calendar, Clock, RotateCcw, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/Modal";
import { createClient } from "@/lib/supabase/client";
import {
  fetchAusenciasMes,
  crearAusencia,
  eliminarAusencia,
  COLOR_AUSENCIA,
  isHoliday,
  getDetailedPersonAbsences,
  type FilaPersona,
  type CeldaAusencia,
  type PersonaConSeniority,
  type AusenciaDetalle,
  type DetalleAusenciasPersona,
} from "@/lib/queries/ausencias";
import type { TipoAusencia } from "@/lib/types/database";

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const TIPOS_AUSENCIA: { value: TipoAusencia; label: string }[] = [
  { value: "vacaciones_confirmadas",   label: "Vacaciones confirmadas" },
  { value: "vacaciones_por_confirmar", label: "Vacaciones por confirmar" },
  { value: "permiso_sin_goce",         label: "Permiso sin goce de sueldo" },
  { value: "dia_post_proyecto",        label: "Día post proyecto" },
  { value: "dia_beneficio",            label: "Día beneficio" },
  { value: "dia_administrativo",       label: "Día administrativo" },
  { value: "otro",                     label: "Otro" },
];

const DIAS_SEMANA_LETRA = ["L", "M", "X", "J", "V"];

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function getDia(fechaISO: string): string {
  return String(new Date(fechaISO + "T00:00:00").getDate());
}

function getDow(fechaISO: string): string {
  const d = new Date(fechaISO + "T00:00:00").getDay(); // 1=lun … 5=vie
  return DIAS_SEMANA_LETRA[d - 1] ?? "";
}

function isMonday(fechaISO: string): boolean {
  return new Date(fechaISO + "T00:00:00").getDay() === 1;
}

// ─────────────────────────────────────────────────────────────
//  Tooltip celda
// ─────────────────────────────────────────────────────────────

interface TooltipProps {
  celda: CeldaAusencia;
  persona: PersonaConSeniority;
  fecha: string;
  onEliminar: (id: string) => void;
  eliminando: boolean;
  onEditar: () => void;
  onCerrar: () => void;
  anchorRect: DOMRect; // posición del botón para portal fixed
}

function CeldaTooltip({ celda, persona, fecha, onEliminar, eliminando, onEditar, onCerrar, anchorRect }: TooltipProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cfg = COLOR_AUSENCIA[celda.tipo];
  const labelFecha = new Date(fecha + "T00:00:00").toLocaleDateString("es-CL", {
    weekday: "long", day: "numeric", month: "long",
  });

  return createPortal(
    <>
    {/* Portal: renderiza en body para escapar overflow:auto y stacking contexts */}
    <div
      className="w-52 rounded-xl bg-white border border-[#e8e8e8] shadow-lg p-3 text-left pointer-events-auto"
      style={{
        position: "fixed",
        zIndex: 9999,
        top: anchorRect.top,
        left: anchorRect.left + anchorRect.width / 2,
        transform: "translate(-50%, calc(-100% - 8px))",
      }}
    >
      {/* Tipo badge */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
          style={{ background: cfg.bg }}
        >
          {cfg.label}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onEditar}
            className="text-[#bbb] hover:text-[#4a90e2] transition-colors"
            title="Editar ausencia"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={eliminando}
            className="text-[#bbb] hover:text-red-500 transition-colors"
            title="Eliminar ausencia"
          >
            {eliminando
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Trash2 className="w-3 h-3" />}
          </button>
          <button
            onClick={onCerrar}
            className="text-[#bbb] hover:text-[#555] transition-colors"
            title="Cerrar"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
      {/* Persona */}
      <p className="text-[12px] font-semibold text-[#1a1a1a] leading-tight">
        {persona.nombre} {persona.apellido}
      </p>
      {persona.cargo_actual && (
        <p className="text-[10px] text-[#888] mt-0.5">{persona.cargo_actual}</p>
      )}
      {/* Fecha */}
      <p className="text-[10px] text-[#999] mt-1.5 capitalize">{labelFecha}</p>
      {/* Descripción */}
      {celda.descripcion && (
        <p className="text-[11px] text-[#555] mt-1.5 leading-snug border-t border-[#f0f0f0] pt-1.5">
          {celda.descripcion}
        </p>
      )}
    </div>
    <ConfirmDialog
      open={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      onConfirm={() => { setConfirmOpen(false); onEliminar(celda.ausencia_id); }}
      title="Eliminar ausencia"
      message="¿Estás seguro de que deseas eliminar esta ausencia? Esta acción es irreversible y actualizará el estado de la persona inmediatamente."
      confirmLabel="Confirmar eliminación"
      loading={eliminando}
    />
    </>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────
//  Modal nueva ausencia
// ─────────────────────────────────────────────────────────────

interface EditarAusenciaData {
  id: string;
  tipo: TipoAusencia;
  fecha_inicio: string;
  fecha_fin: string;
  descripcion: string | null;
  personaNombre: string;
}

interface ModalProps {
  personas: PersonaConSeniority[];
  fechaInicial?: string;
  personaInicial?: string;
  editarAusencia?: EditarAusenciaData;
  onClose: () => void;
  onGuardado: () => void;
}

type FormSnapshot = { personaId: string; tipo: TipoAusencia; fechaInicio: string; fechaFin: string; descripcion: string };

function ModalNuevaAusencia({ personas, fechaInicial, personaInicial, editarAusencia, onClose, onGuardado }: ModalProps) {
  const modoEdicion = !!editarAusencia;
  const [personaId, setPersonaId] = useState(personaInicial ?? "");
  const [tipo, setTipo]           = useState<TipoAusencia>(editarAusencia?.tipo ?? "vacaciones_confirmadas");
  const [fechaInicio, setFechaInicio] = useState(editarAusencia?.fecha_inicio ?? fechaInicial ?? "");
  const [fechaFin, setFechaFin]       = useState(editarAusencia?.fecha_fin ?? fechaInicial ?? "");
  const [descripcion, setDescripcion] = useState(editarAusencia?.descripcion ?? "");
  const [guardando, setGuardando]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [history, setHistory]         = useState<FormSnapshot[]>([]);

  function pushAndSet<T>(setter: (v: T) => void, value: T, current: FormSnapshot) {
    setHistory((h) => [...h, current]);
    setter(value);
  }

  function undo() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setPersonaId(prev.personaId);
    setTipo(prev.tipo);
    setFechaInicio(prev.fechaInicio);
    setFechaFin(prev.fechaFin);
    setDescripcion(prev.descripcion);
    setHistory((h) => h.slice(0, -1));
  }

  const supabase = createClient();

  async function handleGuardar() {
    if (!modoEdicion && !personaId) {
      setError("Persona, fecha inicio y fecha fin son obligatorios.");
      return;
    }
    if (!fechaInicio || !fechaFin) {
      setError("Fecha inicio y fecha fin son obligatorios.");
      return;
    }
    if (fechaFin < fechaInicio) {
      setError("La fecha de fin no puede ser anterior al inicio.");
      return;
    }
    setGuardando(true);

    if (modoEdicion) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any)
        .from("ausencia")
        .update({ tipo, fecha_inicio: fechaInicio, fecha_fin: fechaFin, descripcion: descripcion || null })
        .eq("id", editarAusencia!.id);
      setGuardando(false);
      if (err) { setError((err as { message: string }).message); return; }
    } else {
      const { error: err } = await crearAusencia(supabase, {
        persona_id: personaId, tipo,
        fecha_inicio: fechaInicio, fecha_fin: fechaFin,
        descripcion: descripcion || undefined,
      });
      setGuardando(false);
      if (err) { setError(err); return; }
    }

    onGuardado();
    onClose();
  }

  const colorPreview = COLOR_AUSENCIA[tipo]?.bg ?? "#ccc";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl border border-[#e8e8e8] shadow-2xl w-full max-w-sm mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
          <h2 className="text-[14px] font-bold text-[#1a1a1a]">{modoEdicion ? "Editar ausencia" : "Nueva ausencia"}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={undo}
              disabled={history.length === 0}
              title="Deshacer último cambio"
              className="p-1.5 rounded-lg text-[#bbb] hover:text-[#555] hover:bg-[#f5f5f5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="text-[#bbb] hover:text-[#555] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Persona */}
          <div>
            <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">
              Persona
            </label>
            {modoEdicion ? (
              <div className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#555] bg-[#f5f5f5]">
                {editarAusencia!.personaNombre}
              </div>
            ) : (
              <select
                value={personaId}
                onChange={(e) => pushAndSet(setPersonaId, e.target.value, { personaId, tipo, fechaInicio, fechaFin, descripcion })}
                className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] bg-white focus:outline-none focus:border-[#1a1a1a] transition-colors"
              >
                <option value="">Seleccionar persona...</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} {p.apellido}{p.cargo_actual ? ` — ${p.cargo_actual}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">
              Tipo
            </label>
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ background: colorPreview }}
              />
              <select
                value={tipo}
                onChange={(e) => pushAndSet(setTipo, e.target.value as TipoAusencia, { personaId, tipo, fechaInicio, fechaFin, descripcion })}
                className="flex-1 border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] bg-white focus:outline-none focus:border-[#1a1a1a] transition-colors"
              >
                {TIPOS_AUSENCIA.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">
                Desde
              </label>
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => pushAndSet(setFechaInicio, e.target.value, { personaId, tipo, fechaInicio, fechaFin, descripcion })}
                className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] focus:outline-none focus:border-[#1a1a1a] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">
                Hasta
              </label>
              <input
                type="date"
                value={fechaFin}
                min={fechaInicio}
                onChange={(e) => pushAndSet(setFechaFin, e.target.value, { personaId, tipo, fechaInicio, fechaFin, descripcion })}
                className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] focus:outline-none focus:border-[#1a1a1a] transition-colors"
              />
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">
              Nota <span className="font-normal normal-case">(opcional)</span>
            </label>
            <input
              type="text"
              value={descripcion}
              onChange={(e) => pushAndSet(setDescripcion, e.target.value, { personaId, tipo, fechaInicio, fechaFin, descripcion })}
              placeholder="Ej: vacaciones de invierno"
              className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] placeholder-[#ccc] focus:outline-none focus:border-[#1a1a1a] transition-colors"
            />
          </div>
        </div>

        {error && (
          <p className="px-5 pb-2 text-[12px] text-red-500">{error}</p>
        )}

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-[#f0f0f0]">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#e0e0e0] text-[13px] text-[#555] hover:bg-[#f5f5f5] transition-colors font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={handleGuardar}
            disabled={guardando}
            className="flex-1 py-2 rounded-lg bg-[#1a1a1a] hover:bg-[#333] text-[13px] font-semibold text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {guardando ? "Guardando..." : modoEdicion ? "Guardar cambios" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Popover resumen persona
// ─────────────────────────────────────────────────────────────

function formatRangoAus(inicio: string, fin: string): string {
  const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${parseInt(d)} ${MESES[parseInt(m) - 1]}`;
  };
  return inicio === fin ? fmt(inicio) : `${fmt(inicio)} – ${fmt(fin)}`;
}

function BloqueAusencias({ titulo, icono, items, emptyMsg }: {
  titulo: string;
  icono: React.ReactNode;
  items: AusenciaDetalle[];
  emptyMsg: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[#aaa]">{icono}</span>
        <p className="text-[10px] font-bold text-[#888] uppercase tracking-widest">{titulo}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-[#bbb] italic pl-1">{emptyMsg}</p>
      ) : (
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {items.map((a) => (
            <div key={a.id} className="flex items-center justify-between bg-[#fafafa] rounded-lg border border-[#f0f0f0] px-2.5 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLOR_AUSENCIA[a.tipo]?.bg ?? "#9ca3af" }} />
                <div className="min-w-0">
                  <p className="text-[11px] text-[#333] font-semibold truncate">{formatRangoAus(a.fechaInicio, a.fechaFin)}</p>
                  <p className="text-[10px] text-[#999] truncate">{a.tipoLabel}</p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-[#555] flex-shrink-0 ml-3 bg-white border border-[#e8e8e8] rounded-md px-1.5 py-0.5">
                {a.numDias}d
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PopoverPersona({ persona, onClose }: { persona: PersonaConSeniority; onClose: () => void }) {
  const [data, setData]       = useState<DetalleAusenciasPersona | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    setLoading(true);
    getDetailedPersonAbsences(supabase, persona.id).then((d) => { setData(d); setLoading(false); });
  }, [persona.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = data?.totalDiasAnioActual ?? 0;
  const badgeStyle: React.CSSProperties =
    total >= 15 ? { background: "#fef2f2", color: "#dc2626" } :
    total >= 10 ? { background: "#fff7ed", color: "#ea580c" } :
    total >  0  ? { background: "#eff6ff", color: "#2563eb" } :
                  { background: "#f3f4f6", color: "#9ca3af" };

  return (
    <>
      {/* Overlay — cierra al clicar fuera */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Tarjeta flotante */}
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-2xl border border-[#e8e8e8] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#f0f0f0] bg-[#fafafa]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#1a1a1a] flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0">
              {persona.nombre[0]}{persona.apellido[0]}
            </div>
            <div>
              <p className="text-[13px] font-bold text-[#1a1a1a]">{persona.nombre} {persona.apellido}</p>
              {persona.cargo_actual && <p className="text-[10px] text-[#888] mt-0.5">{persona.cargo_actual}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#e8e8e8] text-[#bbb] hover:text-[#555] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Cuerpo */}
        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-[#888]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Cargando...</span>
          </div>
        ) : data ? (
          <div className="px-4 py-4 space-y-4">
            {/* Total destacado */}
            <div className="flex items-center justify-between bg-[#f8faff] rounded-xl border border-[#dbeafe] px-4 py-3">
              <span className="text-[12px] font-semibold text-[#3b82f6]">Total días consumidos</span>
              <span className="text-[20px] font-black" style={badgeStyle}>{total}</span>
            </div>
            {/* Próximas */}
            <BloqueAusencias
              titulo="Próximas ausencias"
              icono={<Clock className="w-3 h-3" />}
              items={data.ausenciasFuturas}
              emptyMsg="Sin ausencias planificadas"
            />
            {/* Historial */}
            <BloqueAusencias
              titulo="Historial año actual"
              icono={<Calendar className="w-3 h-3" />}
              items={data.ausenciasPasadasAnioActual}
              emptyMsg="Sin historial este año"
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
//  Helpers de resumen por cargo
// ─────────────────────────────────────────────────────────────

function pctStyle(pct: number): { bg: string; text: string } | null {
  if (pct === 0) return null;
  if (pct <= 25)  return { bg: "#ecfdf5", text: "#065f46" }; // verde suave
  if (pct <= 50)  return { bg: "#fffbeb", text: "#92400e" }; // ámbar
  if (pct <= 75)  return { bg: "#fff7ed", text: "#9a3412" }; // naranja
  return           { bg: "#fef2f2", text: "#991b1b" };        // rojo
}

// ─────────────────────────────────────────────────────────────
//  Heatmap principal
// ─────────────────────────────────────────────────────────────

interface HeatmapAusenciasProps {
  year: number;
  month: number;
  externalModalOpen?: boolean;
  onExternalModalClose?: () => void;
}

export function HeatmapAusencias({
  year,
  month,
  externalModalOpen = false,
  onExternalModalClose,
}: HeatmapAusenciasProps) {
  const [filas, setFilas]   = useState<FilaPersona[]>([]);
  const [dias, setDias]     = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [totalesAnio, setTotalesAnio] = useState<Record<string, number>>({});

  // Tooltip activo: { personaId, fecha }
  const [tooltip, setTooltip] = useState<{ personaId: string; fecha: string; rect: DOMRect } | null>(null);
  const [eliminando, setEliminando] = useState<string | null>(null);
  type AusenciaSnapshot = { persona_id: string; tipo: TipoAusencia; fecha_inicio: string; fecha_fin: string; descripcion: string | null };
  const [undoStack, setUndoStack] = useState<AusenciaSnapshot[]>([]);
  const [undoing, setUndoing] = useState(false);

  // Modal de nueva ausencia
  const [modalOpen, setModalOpen]       = useState(false);
  const [modalFecha, setModalFecha]     = useState<string | undefined>();
  const [modalPersona, setModalPersona] = useState<string | undefined>();

  // Modal editar ausencia
  const [editModalData, setEditModalData] = useState<EditarAusenciaData | null>(null);

  // Popover resumen persona
  const [popoverPersona, setPopoverPersona] = useState<PersonaConSeniority | null>(null);

  const supabase = createClient();

  // Colapso nivel 1 (cargos) y nivel 2 (personas)
  const [cargoColapsados, setCargoColapsados] = useState<Set<string>>(new Set());
  const [personaColapsados, setPersonaColapsados] = useState<Set<string>>(new Set());

  function toggleCargo(cargo: string) {
    setCargoColapsados(prev => { const s = new Set(prev); s.has(cargo) ? s.delete(cargo) : s.add(cargo); return s; });
  }
  function togglePersona(id: string) {
    setPersonaColapsados(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  // Sincronizar modal externo (desde la página)
  useEffect(() => {
    if (externalModalOpen) {
      setModalFecha(undefined);
      setModalPersona(undefined);
      setModalOpen(true);
    }
  }, [externalModalOpen]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);

    const hoy        = new Date().toISOString().split("T")[0];
    const inicioAnio = `${new Date().getFullYear()}-01-01`;

    // Carga del mes + totales anuales en paralelo
    const [result, ausAnioRes] = await Promise.all([
      fetchAusenciasMes(supabase, year, month),
      supabase
        .from("ausencia")
        .select("persona_id, fecha_inicio, fecha_fin")
        .gte("fecha_fin", inicioAnio)
        .lte("fecha_inicio", hoy),
    ]);

    setCargando(false);
    if (result.error) { setError(result.error); return; }
    setFilas(result.filas);
    setDias(result.dias);

    // Calcular totales anuales por persona (días hábiles sin feriados)
    if (ausAnioRes.data) {
      const { calculateBusinessDays } = await import("@/lib/utils/date-utils");
      const map: Record<string, number> = {};
      for (const a of ausAnioRes.data as { persona_id: string; fecha_inicio: string; fecha_fin: string }[]) {
        const ini = a.fecha_inicio > inicioAnio ? a.fecha_inicio : inicioAnio;
        const fin = a.fecha_fin   < hoy         ? a.fecha_fin   : hoy;
        if (ini <= fin) map[a.persona_id] = (map[a.persona_id] ?? 0) + calculateBusinessDays(ini, fin);
      }
      setTotalesAnio(map);
    }
  }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  async function handleEliminar(ausenciaId: string) {
    // Guardar snapshot antes de borrar
    const { data } = await supabase
      .from("ausencia")
      .select("persona_id, tipo, fecha_inicio, fecha_fin, descripcion")
      .eq("id", ausenciaId)
      .single();
    if (data) setUndoStack((s) => [...s, data as AusenciaSnapshot].slice(-2));

    setEliminando(ausenciaId);
    await eliminarAusencia(supabase, ausenciaId);
    setEliminando(null);
    setTooltip(null);
    cargar();
  }

  async function handleAbrirEditar(ausenciaId: string, persona: PersonaConSeniority) {
    type AusRow = { id: string; tipo: TipoAusencia; fecha_inicio: string; fecha_fin: string; descripcion: string | null };
    const { data } = await supabase
      .from("ausencia")
      .select("id, tipo, fecha_inicio, fecha_fin, descripcion")
      .eq("id", ausenciaId)
      .single() as unknown as { data: AusRow | null };
    if (data) {
      setEditModalData({
        id: data.id,
        tipo: data.tipo,
        fecha_inicio: data.fecha_inicio,
        fecha_fin: data.fecha_fin,
        descripcion: data.descripcion,
        personaNombre: `${persona.nombre} ${persona.apellido}`,
      });
      setTooltip(null);
    }
  }

  async function handleUndo() {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoing(true);
    await crearAusencia(supabase, {
      persona_id: last.persona_id,
      tipo: last.tipo,
      fecha_inicio: last.fecha_inicio,
      fecha_fin: last.fecha_fin,
      descripcion: last.descripcion ?? undefined,
    });
    setUndoStack((s) => s.slice(0, -1));
    setUndoing(false);
    cargar();
  }

  function handleCloseModal() {
    setModalOpen(false);
    onExternalModalClose?.();
  }

  const todasPersonas = filas.map((f) => f.persona);

  // Agrupar filas por cargo (manteniendo el orden original de seniority)
  const grupos = useMemo(() => {
    const map = new Map<string, FilaPersona[]>();
    for (const fila of filas) {
      const cargo = fila.persona.cargo_actual ?? "Sin cargo";
      if (!map.has(cargo)) map.set(cargo, []);
      map.get(cargo)!.push(fila);
    }
    return Array.from(map.entries()); // [cargo, FilaPersona[]][]
  }, [filas]);

  function colapsarTodo() { setCargoColapsados(new Set(grupos.map(([c]) => c))); }
  function expandirTodo()  { setCargoColapsados(new Set()); setPersonaColapsados(new Set()); }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {cargando ? (
        <div className="flex-1 flex items-center justify-center text-[#888] gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Cargando ausencias...</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-red-500 text-sm">
          Error: {error}
        </div>
      ) : filas.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[#999] gap-3">
          <p className="text-sm">No hay personas activas registradas.</p>
        </div>
      ) : (
        <>
        <div className="flex-1 overflow-auto">
          <table className="border-collapse w-full text-[12px]" style={{ minWidth: `${140 + dias.length * 20}px` }}>

            {/* ── Encabezado ── */}
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  className="sticky left-0 z-30 bg-[#fafafa] border-b border-r border-[#ebebeb] px-2 py-0.5 text-left text-[10px] font-semibold text-[#888] uppercase tracking-wide"
                  style={{ minWidth: 140, width: 140 }}
                >
                  {/* Controles fusionados: eliminan la barra intermedia */}
                  <div className="flex items-center justify-between gap-1">
                    <span>Persona</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleUndo}
                        disabled={undoStack.length === 0 || undoing}
                        title="Deshacer última eliminación"
                        className="p-0.5 rounded hover:bg-[#e8e8e8] text-[#bbb] hover:text-[#555] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {undoing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={cargoColapsados.size >= grupos.length ? expandirTodo : colapsarTodo}
                        title={cargoColapsados.size >= grupos.length ? "Expandir todo" : "Colapsar todo"}
                        className="p-0.5 rounded hover:bg-[#e8e8e8] text-[#bbb] hover:text-[#555] transition-colors"
                      >
                        {cargoColapsados.size >= grupos.length
                          ? <ChevronRight className="w-3 h-3" />
                          : <ChevronDown  className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </th>
                {dias.map((fecha) => {
                  const esLunes   = isMonday(fecha);
                  const esFeriado = isHoliday(fecha);
                  return (
                    <th
                      key={fecha}
                      className={`border-b border-[#ebebeb] px-0 py-0.5 text-center ${esLunes ? "border-l border-[#ddd]" : ""} ${esFeriado ? "bg-gray-200" : "bg-[#fafafa]"}`}
                      style={{ minWidth: 20, width: 20 }}
                      title={esFeriado ? "Feriado" : undefined}
                    >
                      <div className={`text-[8px] font-medium leading-none ${esFeriado ? "text-gray-400" : "text-[#bbb]"}`}>{getDow(fecha)}</div>
                      <div className={`text-[9px] font-semibold leading-none ${esFeriado ? "text-gray-400" : "text-[#555]"}`}>{getDia(fecha)}</div>
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

                    {/* ── Cabecera de cargo (Nivel 1) ── */}
                    <tr className="bg-[#f0f0f0] border-t-2 border-b border-[#ddd]">
                      <td
                        className="sticky left-0 z-10 bg-[#f0f0f0] border-r border-[#ddd] px-2 py-1.5"
                        style={{ minWidth: 200, width: 200 }}
                      >
                        <button
                          onClick={() => toggleCargo(cargo)}
                          className="flex items-center gap-1.5 w-full text-left hover:opacity-70 transition-opacity"
                        >
                          {estaColapsadoCargo
                            ? <ChevronRight className="w-3 h-3 text-[#777] flex-shrink-0" />
                            : <ChevronDown  className="w-3 h-3 text-[#777] flex-shrink-0" />}
                          <span className="text-[10px] font-bold text-[#444] uppercase tracking-wide truncate">
                            {cargo}
                          </span>
                          <span className="text-[9px] text-[#aaa] ml-1 flex-shrink-0">
                            · {filasGrupo.length} {filasGrupo.length === 1 ? "persona" : "personas"}
                          </span>
                        </button>
                      </td>
                      {/* Cuando colapsado: muestra % de ausencia del cargo por día */}
                      {dias.map((fecha) => {
                        const esLunes = isMonday(fecha);
                        if (!estaColapsadoCargo) {
                          return <td key={fecha} className={`border-b border-[#e8e8e8] ${esLunes ? "border-l border-[#ddd]" : ""}`} style={{ minWidth: 34, width: 34 }} />;
                        }
                        const ausentes = filasGrupo.filter((f) => f.dias[fecha] != null).length;
                        const total    = filasGrupo.length;
                        const pct      = total > 0 ? Math.round((ausentes / total) * 100) : 0;
                        const estilo   = pctStyle(pct);
                        return (
                          <td key={fecha} className={`px-0.5 py-1 text-center ${esLunes ? "border-l border-[#ddd]" : ""}`}
                            style={{ minWidth: 34, width: 34 }}
                            title={pct > 0 ? `${ausentes}/${total} ausentes (${pct}%)` : "Sin ausencias"}
                          >
                            {estilo ? (
                              <div className="w-full h-5 rounded flex items-center justify-center" style={{ background: estilo.bg }}>
                                <span className="text-[8px] font-bold" style={{ color: estilo.text }}>{pct}%</span>
                              </div>
                            ) : <div className="w-full h-5" />}
                          </td>
                        );
                      })}
                    </tr>

                    {/* ── Filas de personas (Nivel 2, visibles solo cuando cargo expandido) ── */}
                    {!estaColapsadoCargo && filasGrupo.map((fila, rowIdx) => {
                      const estaColapsadaPersona = personaColapsados.has(fila.persona.id);
                      return (
                        <tr key={fila.persona.id} className={rowIdx % 2 === 0 ? "bg-white" : "bg-[#fafafa]"}>

                          {/* Nombre + chevron persona */}
                          <td
                            className="sticky left-0 z-10 bg-inherit border-r border-[#ebebeb] px-1.5 py-0"
                            style={{ minWidth: 140, width: 140 }}
                          >
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => togglePersona(fila.persona.id)}
                                className="flex-shrink-0 p-0.5 rounded hover:bg-[#e8e8e8] text-[#ccc] hover:text-[#888] transition-colors"
                                title={estaColapsadaPersona ? "Expandir" : "Colapsar"}
                              >
                                {estaColapsadaPersona
                                  ? <ChevronRight className="w-3 h-3" />
                                  : <ChevronDown  className="w-3 h-3" />}
                              </button>
                              <div className="min-w-0 flex-1 overflow-hidden">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setPopoverPersona(fila.persona); }}
                                    className="text-[11px] font-medium leading-tight text-[#1a1a1a] truncate hover:text-[#2563eb] hover:underline transition-colors text-left"
                                    title="Ver resumen de ausencias"
                                  >
                                    {fila.persona.nombre} {fila.persona.apellido}
                                  </button>
                                  {/* Badge días acumulados año actual */}
                                  {(() => {
                                    const d = totalesAnio[fila.persona.id] ?? 0;
                                    if (d === 0) return null;
                                    const style: React.CSSProperties =
                                      d >= 15 ? { background: "#fef2f2", color: "#dc2626" } :
                                      d >= 10 ? { background: "#fff7ed", color: "#ea580c" } :
                                               { background: "#eff6ff", color: "#2563eb" };
                                    return (
                                      <span
                                        className="flex-shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
                                        title="Total de días de ausencia consumidos en el período seleccionado"
                                      >
                                        {d === 1 ? "1 día ya tomado" : `${d} días ya tomados`}
                                      </span>
                                    );
                                  })()}
                                </div>
                                {!estaColapsadaPersona && fila.persona.cargo_actual && (
                                  <div className="text-[9px] leading-none text-[#999] truncate">{fila.persona.cargo_actual}</div>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Celdas de días */}
                          {dias.map((fecha) => {
                            const celda      = fila.dias[fecha];
                            const esLunes    = isMonday(fecha);
                            const esFeriado  = isHoliday(fecha);

                            if (estaColapsadaPersona) {
                              return (
                                <td key={fecha}
                                  className={`py-px px-px border-b border-[#f5f5f5] ${esLunes ? "border-l border-[#ddd]" : ""} ${esFeriado ? "bg-gray-200" : ""}`}
                                  style={{ minWidth: 20, width: 20 }}
                                  title={esFeriado ? "Feriado" : celda ? COLOR_AUSENCIA[celda.tipo]?.label : undefined}
                                >
                                  {celda
                                    ? <div className="w-full h-2.5 rounded-sm" style={{ background: COLOR_AUSENCIA[celda.tipo]?.bg ?? "#94a3b8" }} />
                                    : esFeriado
                                      ? <div className="w-full h-2.5 rounded-sm bg-gray-400 opacity-40" />
                                      : <div className="w-full h-2.5" />
                                  }
                                </td>
                              );
                            }

                            const isActive = tooltip?.personaId === fila.persona.id && tooltip?.fecha === fecha;
                            return (
                              <td key={fecha}
                                className={`py-px px-px border-b border-[#f5f5f5] relative ${esLunes ? "border-l border-[#ddd]" : ""} ${esFeriado ? "bg-gray-200" : ""}`}
                                style={{ minWidth: 20, width: 20 }}
                              >
                                {celda ? (
                                  <div className="relative">
                                    <button type="button"
                                      onClick={(e) => {
                                        if (isActive) { setTooltip(null); return; }
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        setTooltip({ personaId: fila.persona.id, fecha, rect });
                                      }}
                                      className="w-full h-4 rounded transition-opacity hover:opacity-75"
                                      style={{ background: COLOR_AUSENCIA[celda.tipo]?.bg ?? "#ccc" }}
                                      title={COLOR_AUSENCIA[celda.tipo]?.label}
                                    />
                                    {isActive && (
                                      <CeldaTooltip celda={celda} persona={fila.persona} fecha={fecha}
                                        onEliminar={handleEliminar} eliminando={eliminando === celda.ausencia_id}
                                        onEditar={() => handleAbrirEditar(celda.ausencia_id, fila.persona)}
                                        onCerrar={() => setTooltip(null)}
                                        anchorRect={tooltip!.rect}
                                      />
                                    )}
                                  </div>
                                ) : esFeriado ? (
                                  /* Celda feriado: visible con gris, sin interacción */
                                  <div className="w-full h-4 rounded bg-gray-400 opacity-40" title="Feriado" />
                                ) : (
                                  <button type="button"
                                    className="w-full h-4 rounded hover:bg-[#f0f0f0] transition-colors group"
                                    onClick={() => { setModalPersona(fila.persona.id); setModalFecha(fecha); setModalOpen(true); }}
                                    title="Agregar ausencia"
                                  >
                                    <Plus className="w-2 h-2 text-[#ddd] group-hover:text-[#bbb] mx-auto transition-colors" />
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}

                    {/* ── Fila resumen del cargo (solo cuando expandido) ── */}
                    {!estaColapsadoCargo && (
                      <tr className="bg-[#f4f4f4] border-t border-b border-[#e0e0e0]">
                        <td
                          className="sticky left-0 z-10 bg-[#f4f4f4] border-r border-[#e0e0e0] px-2 py-0.5"
                          style={{ minWidth: 140, width: 140 }}
                        >
                          <div className="text-[10px] font-bold text-[#555] uppercase tracking-wide truncate">
                            Resumen · {cargo}
                          </div>
                          <div className="text-[9px] text-[#999]">
                            {filasGrupo.length} {filasGrupo.length === 1 ? "persona" : "personas"}
                          </div>
                        </td>
                        {dias.map((fecha) => {
                          const ausentes = filasGrupo.filter((f) => f.dias[fecha] != null).length;
                          const total    = filasGrupo.length;
                          const pct      = total > 0 ? Math.round((ausentes / total) * 100) : 0;
                          const estilo   = pctStyle(pct);
                          const esLunes  = isMonday(fecha);
                          return (
                            <td key={fecha}
                              className={`px-px py-px text-center ${esLunes ? "border-l border-[#ddd]" : ""}`}
                              style={{ minWidth: 20, width: 20 }}
                              title={pct > 0 ? `${ausentes} de ${total} ausentes (${pct}%)` : "Sin ausencias"}
                            >
                              {estilo ? (
                                <div className="w-full h-3 rounded flex items-center justify-center" style={{ background: estilo.bg }}>
                                  <span className="text-[9px] font-bold leading-none" style={{ color: estilo.text }}>{pct}%</span>
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
        </>
      )}

      {/* ── Modal nueva ausencia ── */}
      {modalOpen && (
        <ModalNuevaAusencia
          personas={todasPersonas}
          fechaInicial={modalFecha}
          personaInicial={modalPersona}
          onClose={handleCloseModal}
          onGuardado={cargar}
        />
      )}

      {/* ── Modal editar ausencia ── */}
      {editModalData && (
        <ModalNuevaAusencia
          personas={todasPersonas}
          editarAusencia={editModalData}
          onClose={() => setEditModalData(null)}
          onGuardado={cargar}
        />
      )}

      {/* Overlay para cerrar tooltip */}
      {tooltip && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setTooltip(null)}
        />
      )}

      {/* Popover resumen persona */}
      {popoverPersona && (
        <PopoverPersona
          persona={popoverPersona}
          onClose={() => setPopoverPersona(null)}
        />
      )}
    </div>
  );
}
