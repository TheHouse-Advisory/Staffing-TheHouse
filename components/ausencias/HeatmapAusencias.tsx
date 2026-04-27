"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { X, Loader2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchAusenciasMes,
  crearAusencia,
  eliminarAusencia,
  COLOR_AUSENCIA,
  type FilaPersona,
  type CeldaAusencia,
  type PersonaConSeniority,
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
}

function CeldaTooltip({ celda, persona, fecha, onEliminar, eliminando }: TooltipProps) {
  const cfg = COLOR_AUSENCIA[celda.tipo];
  const labelFecha = new Date(fecha + "T00:00:00").toLocaleDateString("es-CL", {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-xl bg-white border border-[#e8e8e8] shadow-lg p-3 text-left pointer-events-auto">
      {/* Tipo badge */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
          style={{ background: cfg.bg }}
        >
          {cfg.label}
        </span>
        <button
          onClick={() => onEliminar(celda.ausencia_id)}
          disabled={eliminando}
          className="text-[#bbb] hover:text-red-500 transition-colors"
          title="Eliminar ausencia"
        >
          {eliminando
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <X className="w-3 h-3" />}
        </button>
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
  );
}

// ─────────────────────────────────────────────────────────────
//  Modal nueva ausencia
// ─────────────────────────────────────────────────────────────

interface ModalProps {
  personas: PersonaConSeniority[];
  fechaInicial?: string;
  personaInicial?: string;
  onClose: () => void;
  onGuardado: () => void;
}

function ModalNuevaAusencia({ personas, fechaInicial, personaInicial, onClose, onGuardado }: ModalProps) {
  const [personaId, setPersonaId] = useState(personaInicial ?? "");
  const [tipo, setTipo]           = useState<TipoAusencia>("vacaciones_confirmadas");
  const [fechaInicio, setFechaInicio] = useState(fechaInicial ?? "");
  const [fechaFin, setFechaFin]       = useState(fechaInicial ?? "");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando]     = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const supabase = createClient();

  async function handleGuardar() {
    if (!personaId || !fechaInicio || !fechaFin) {
      setError("Persona, fecha inicio y fecha fin son obligatorios.");
      return;
    }
    if (fechaFin < fechaInicio) {
      setError("La fecha de fin no puede ser anterior al inicio.");
      return;
    }
    setGuardando(true);
    const { error: err } = await crearAusencia(supabase, {
      persona_id: personaId, tipo,
      fecha_inicio: fechaInicio, fecha_fin: fechaFin,
      descripcion: descripcion || undefined,
    });
    setGuardando(false);
    if (err) { setError(err); return; }
    onGuardado();
    onClose();
  }

  const colorPreview = COLOR_AUSENCIA[tipo]?.bg ?? "#ccc";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl border border-[#e8e8e8] shadow-2xl w-full max-w-sm mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
          <h2 className="text-[14px] font-bold text-[#1a1a1a]">Nueva ausencia</h2>
          <button onClick={onClose} className="text-[#bbb] hover:text-[#555] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Persona */}
          <div>
            <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">
              Persona
            </label>
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] text-[#1a1a1a] bg-white focus:outline-none focus:border-[#1a1a1a] transition-colors"
            >
              <option value="">Seleccionar persona...</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} {p.apellido}{p.cargo_actual ? ` — ${p.cargo_actual}` : ""}
                </option>
              ))}
            </select>
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
                onChange={(e) => setTipo(e.target.value as TipoAusencia)}
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
                onChange={(e) => setFechaInicio(e.target.value)}
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
                onChange={(e) => setFechaFin(e.target.value)}
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
              onChange={(e) => setDescripcion(e.target.value)}
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
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
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

  // Tooltip activo: { personaId, fecha }
  const [tooltip, setTooltip] = useState<{ personaId: string; fecha: string } | null>(null);
  const [eliminando, setEliminando] = useState<string | null>(null);

  // Modal de nueva ausencia
  const [modalOpen, setModalOpen]       = useState(false);
  const [modalFecha, setModalFecha]     = useState<string | undefined>();
  const [modalPersona, setModalPersona] = useState<string | undefined>();

  const supabase = createClient();

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
    const result = await fetchAusenciasMes(supabase, year, month);
    setCargando(false);
    if (result.error) { setError(result.error); return; }
    setFilas(result.filas);
    setDias(result.dias);
  }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  async function handleEliminar(ausenciaId: string) {
    setEliminando(ausenciaId);
    await eliminarAusencia(supabase, ausenciaId);
    setEliminando(null);
    setTooltip(null);
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
        <div className="flex-1 overflow-auto">
          <table className="border-collapse w-full text-[12px]" style={{ minWidth: `${180 + dias.length * 36}px` }}>

            {/* ── Encabezado ── */}
            <thead className="sticky top-0 z-20">
              <tr>
                {/* Columna persona */}
                <th
                  className="sticky left-0 z-30 bg-[#fafafa] border-b border-r border-[#ebebeb] px-4 py-2.5 text-left text-[11px] font-semibold text-[#888] uppercase tracking-wide"
                  style={{ minWidth: 200, width: 200 }}
                >
                  Persona
                </th>

                {/* Columna por día */}
                {dias.map((fecha) => {
                  const esLunes = isMonday(fecha);
                  return (
                    <th
                      key={fecha}
                      className={`bg-[#fafafa] border-b border-[#ebebeb] px-0 py-1.5 text-center ${esLunes ? "border-l border-[#ddd]" : ""}`}
                      style={{ minWidth: 34, width: 34 }}
                    >
                      <div className="text-[9px] text-[#bbb] font-medium">{getDow(fecha)}</div>
                      <div className="text-[11px] text-[#555] font-semibold">{getDia(fecha)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* ── Filas agrupadas por cargo ── */}
            <tbody>
              {grupos.map(([cargo, filasGrupo]) => (
                <React.Fragment key={cargo}>
                  {/* Filas de personas del grupo */}
                  {filasGrupo.map((fila, rowIdx) => (
                    <tr
                      key={fila.persona.id}
                      className={rowIdx % 2 === 0 ? "bg-white" : "bg-[#fafafa]"}
                    >
                      {/* Nombre */}
                      <td
                        className="sticky left-0 z-10 bg-inherit border-r border-[#ebebeb] px-4 py-2"
                        style={{ minWidth: 200, width: 200 }}
                      >
                        <div className="text-[12px] font-semibold text-[#1a1a1a] truncate">
                          {fila.persona.nombre} {fila.persona.apellido}
                        </div>
                        {fila.persona.cargo_actual && (
                          <div className="text-[10px] text-[#999] truncate">{fila.persona.cargo_actual}</div>
                        )}
                      </td>

                      {/* Celdas de días */}
                      {dias.map((fecha) => {
                        const celda = fila.dias[fecha];
                        const esLunes = isMonday(fecha);
                        const isActive = tooltip?.personaId === fila.persona.id && tooltip?.fecha === fecha;

                        return (
                          <td
                            key={fecha}
                            className={`py-1 px-0.5 border-b border-[#f5f5f5] relative ${esLunes ? "border-l border-[#ddd]" : ""}`}
                            style={{ minWidth: 34, width: 34 }}
                          >
                            {celda ? (
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setTooltip(isActive ? null : { personaId: fila.persona.id, fecha })}
                                  className="w-full h-7 rounded transition-opacity hover:opacity-75"
                                  style={{ background: COLOR_AUSENCIA[celda.tipo]?.bg ?? "#ccc" }}
                                  title={COLOR_AUSENCIA[celda.tipo]?.label}
                                />
                                {isActive && (
                                  <CeldaTooltip
                                    celda={celda}
                                    persona={fila.persona}
                                    fecha={fecha}
                                    onEliminar={handleEliminar}
                                    eliminando={eliminando === celda.ausencia_id}
                                  />
                                )}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="w-full h-7 rounded hover:bg-[#f0f0f0] transition-colors group"
                                onClick={() => {
                                  setModalPersona(fila.persona.id);
                                  setModalFecha(fecha);
                                  setModalOpen(true);
                                }}
                                title="Agregar ausencia"
                              >
                                <Plus className="w-3 h-3 text-[#ddd] group-hover:text-[#bbb] mx-auto transition-colors" />
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* Fila de resumen del cargo */ }
                  <tr key={`summary-${cargo}`} className="bg-[#f4f4f4] border-t border-b border-[#e0e0e0]">
                    {/* Etiqueta del cargo */}
                    <td
                      className="sticky left-0 z-10 bg-[#f4f4f4] border-r border-[#e0e0e0] px-4 py-1.5"
                      style={{ minWidth: 200, width: 200 }}
                    >
                      <div className="text-[10px] font-bold text-[#555] uppercase tracking-wide truncate">
                        {cargo}
                      </div>
                      <div className="text-[9px] text-[#999]">
                        {filasGrupo.length} {filasGrupo.length === 1 ? "persona" : "personas"}
                      </div>
                    </td>

                    {/* % ausente por día */}
                    {dias.map((fecha) => {
                      const ausentes = filasGrupo.filter((f) => f.dias[fecha] != null).length;
                      const total = filasGrupo.length;
                      const pct = total > 0 ? Math.round((ausentes / total) * 100) : 0;
                      const estilo = pctStyle(pct);
                      const esLunes = isMonday(fecha);

                      return (
                        <td
                          key={fecha}
                          className={`px-0.5 py-1 text-center ${esLunes ? "border-l border-[#ddd]" : ""}`}
                          style={{ minWidth: 34, width: 34 }}
                          title={pct > 0 ? `${ausentes} de ${total} ausentes (${pct}%)` : "Sin ausencias"}
                        >
                          {estilo ? (
                            <div
                              className="w-full h-6 rounded flex items-center justify-center"
                              style={{ background: estilo.bg }}
                            >
                              <span className="text-[9px] font-bold leading-none" style={{ color: estilo.text }}>
                                {pct}%
                              </span>
                            </div>
                          ) : (
                            <div className="w-full h-6" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
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

      {/* Overlay para cerrar tooltip */}
      {tooltip && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setTooltip(null)}
        />
      )}
    </div>
  );
}
