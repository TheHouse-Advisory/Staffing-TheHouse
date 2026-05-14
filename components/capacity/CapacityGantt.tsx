"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Loader2, Pencil, X, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchCapacityData,
  upsertCapacity,
  upsertCapacityBulkAll,
  labelSemana,
  esPrimerLunesMes,
  cargoAGrupo,
  CAPACITY_GRUPO_ORDER,
  type PersonaCapacity,
  type CapacityData,
} from "@/lib/queries/capacity";

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function getVal(valores: Record<string, Record<string, number>>, pid: string, sem: string): number {
  return valores[pid]?.[sem] ?? 1;
}

function cellColor(v: number, flash: boolean): string {
  if (flash) return "#d1fae5"; // verde flash al actualizar masivamente
  if (v === 0) return "#f3f4f6";
  if (v === 1) return "#eff6ff";
  if (v === 2) return "#dbeafe";
  return "#bfdbfe";
}

function cellText(v: number, flash: boolean): string {
  if (flash) return "#065f46";
  if (v === 0) return "#9ca3af";
  return "#1d4ed8";
}

// ─────────────────────────────────────────────────────────────
//  Modal edición por persona (alcance: año o meses específicos)
// ─────────────────────────────────────────────────────────────

const MESES_LABELS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

interface PersonaEditModalProps {
  persona: PersonaCapacity;
  semanas: string[];
  onConfirm: (semanasFiltradas: string[], capacidad: number) => Promise<void>;
  onClose: () => void;
}

function PersonaEditModal({ persona, semanas, onConfirm, onClose }: PersonaEditModalProps) {
  const [valor, setValor]         = useState("1");
  const [scope, setScope]         = useState<"anio" | "meses">("anio");
  const [mesesSel, setMesesSel]   = useState<Set<number>>(new Set());
  const [saving, setSaving]       = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function toggleMes(m: number) {
    setMesesSel(prev => { const s = new Set(prev); s.has(m) ? s.delete(m) : s.add(m); return s; });
  }

  async function handleConfirm() {
    const v = Math.max(0, Math.min(10, parseFloat(valor) || 0));
    // Filtrar semanas según alcance
    const filtradas = scope === "anio"
      ? semanas
      : semanas.filter(s => mesesSel.has(new Date(s + "T00:00:00").getMonth()));
    if (filtradas.length === 0) return;
    setSaving(true);
    await onConfirm(filtradas, Math.round(v)); // capacity es entero en BD
    setSaving(false);
    onClose();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-2xl border border-[#e8e8e8] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0f0f0] bg-[#fafafa]">
          <div>
            <p className="text-[12px] font-bold text-[#1a1a1a]">Actualizar capacidad</p>
            <p className="text-[10px] text-[#888] mt-0.5">{persona.nombre} {persona.apellido}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#e8e8e8] text-[#bbb] hover:text-[#555] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Input numérico */}
          <div>
            <label className="text-[10px] font-bold text-[#888] uppercase tracking-wide block mb-1.5">
              Nueva capacidad (proyectos)
            </label>
            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                type="number" min={0} max={10}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={handleKey}
                className="w-20 text-center text-[22px] font-black border-2 border-[#e0e0e0] rounded-xl py-2 focus:outline-none focus:border-[#2563eb] transition-colors text-[#1d4ed8]"
              />
              <div className="flex flex-col gap-1">
                {[0,1,2,3].map(n => (
                  <button key={n} onClick={() => setValor(String(n))}
                    className={`text-[10px] font-semibold py-0.5 px-2.5 rounded-lg border transition-colors ${valor === String(n) ? "bg-[#2563eb] text-white border-[#2563eb]" : "border-[#e0e0e0] text-[#555] hover:bg-[#f5f5f5]"}`}>
                    {n} {n === 1 ? "proyecto" : n === 0 ? "— ninguno" : "proyectos"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Selector de alcance */}
          <div>
            <label className="text-[10px] font-bold text-[#888] uppercase tracking-wide block mb-1.5">
              Alcance
            </label>
            <div className="flex gap-2">
              {(["anio", "meses"] as const).map(s => (
                <button key={s} onClick={() => setScope(s)}
                  className={`flex-1 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${scope === s ? "bg-[#1a1a1a] text-white border-[#1a1a1a]" : "border-[#e0e0e0] text-[#555] hover:bg-[#f5f5f5]"}`}>
                  {s === "anio" ? "Todo el año" : "Meses específicos"}
                </button>
              ))}
            </div>
          </div>

          {/* Selector de meses (solo cuando scope = meses) */}
          {scope === "meses" && (
            <div>
              <label className="text-[10px] font-bold text-[#888] uppercase tracking-wide block mb-1.5">
                Selecciona meses
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {MESES_LABELS.map((m, i) => (
                  <button key={i} onClick={() => toggleMes(i)}
                    className={`py-1 rounded-lg border text-[10px] font-bold transition-colors ${mesesSel.has(i) ? "bg-[#2563eb] text-white border-[#2563eb]" : "border-[#e0e0e0] text-[#666] hover:bg-[#f5f5f5]"}`}>
                    {m}
                  </button>
                ))}
              </div>
              {mesesSel.size === 0 && (
                <p className="text-[10px] text-[#f59e0b] mt-1">Selecciona al menos un mes</p>
              )}
            </div>
          )}
        </div>

        <div className="px-4 pb-4">
          <button
            onClick={handleConfirm}
            disabled={saving || (scope === "meses" && mesesSel.size === 0)}
            className="w-full py-2.5 rounded-xl bg-[#1a1a1a] hover:bg-[#333] text-white text-[12px] font-bold transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando...</>
              : <><Check className="w-3.5 h-3.5" /> Aplicar cambio</>}
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
//  Modal edición masiva
// ─────────────────────────────────────────────────────────────

interface BulkModalProps {
  grupo: string;
  onConfirm: (v: number) => Promise<void>;
  onClose: () => void;
}

function BulkEditModal({ grupo, onConfirm, onClose }: BulkModalProps) {
  const [valor, setValor]     = useState("1");
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  async function handleConfirm() {
    const v = Math.max(0, Math.min(10, parseInt(valor) || 0));
    setSaving(true);
    await onConfirm(v);
    setSaving(false);
    onClose();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") onClose();
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Modal pequeño centrado */}
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 bg-white rounded-2xl border border-[#e8e8e8] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0f0f0] bg-[#fafafa]">
          <div>
            <p className="text-[12px] font-bold text-[#1a1a1a]">Set Capacity</p>
            <p className="text-[10px] text-[#888] mt-0.5 uppercase tracking-wide">{grupo}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#e8e8e8] text-[#bbb] hover:text-[#555] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <p className="text-[12px] text-[#555]">
            ¿Cuántos proyectos puede llevar cada persona de <strong>{grupo}</strong>?
          </p>
          <p className="text-[10px] text-[#aaa]">
            Se aplicará a <strong>todas las personas</strong> del grupo y <strong>todas las semanas</strong> del año.
          </p>

          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="number"
              min={0} max={10}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={handleKey}
              className="w-20 text-center text-[20px] font-black border-2 border-[#e0e0e0] rounded-xl py-2 focus:outline-none focus:border-[#2563eb] transition-colors text-[#1d4ed8]"
            />
            <div className="flex-1 flex flex-col gap-1">
              {[0,1,2,3].map(n => (
                <button
                  key={n}
                  onClick={() => setValor(String(n))}
                  className={`text-[11px] font-semibold py-0.5 px-3 rounded-lg border transition-colors ${valor === String(n) ? "bg-[#2563eb] text-white border-[#2563eb]" : "border-[#e0e0e0] text-[#555] hover:bg-[#f5f5f5]"}`}
                >
                  {n} {n === 0 ? "— sin proyectos" : n === 1 ? "proyecto" : "proyectos"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 pb-4">
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="w-full py-2.5 rounded-xl bg-[#1a1a1a] hover:bg-[#333] text-white text-[12px] font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando...</>
              : <><Check className="w-3.5 h-3.5" /> Aplicar a todo el año</>}
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────────────────────

// Grupos que participan en el cálculo de capacidad real (min)
const GRUPOS_BOTTLENECK = ["Gerentes / Directores", "Seniors / Asociados", "Consultores"];

export interface CapacityStats {
  /** grupo → semana → suma de capacidades */
  grupoTotales: Record<string, Record<string, number>>;
  semanas: string[];
}

interface Props {
  year: number;
  onStatsChange?: (stats: CapacityStats) => void;
}

export function CapacityGantt({ year, onStatsChange }: Props) {
  const [data, setData]       = useState<CapacityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [valores, setValores] = useState<Record<string, Record<string, number>>>({});
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  // grupo activo para el modal bulk
  const [bulkGrupo, setBulkGrupo] = useState<string | null>(null);
  // persona activa para el modal individual
  const [personaEdit, setPersonaEdit] = useState<PersonaCapacity | null>(null);
  // persona_id con loading mientras se guarda
  const [loadingPersona, setLoadingPersona] = useState<string | null>(null);
  // set de "persona_id:semana" que están en flash verde
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());

  const timers    = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const supabase  = createClient();

  const cargar = useCallback(async () => {
    setLoading(true);
    const d = await fetchCapacityData(supabase, year);
    setData(d);
    setValores(d.valores);
    setLoading(false);
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  // Debe declararse ANTES que los hooks que lo usan
  const grupos = useMemo(() => {
    if (!data) return new Map<string, PersonaCapacity[]>();
    const map = new Map<string, PersonaCapacity[]>();
    for (const p of data.personas) {
      const g = cargoAGrupo(p.cargo_actual);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    const ordered = new Map<string, PersonaCapacity[]>();
    for (const g of CAPACITY_GRUPO_ORDER) { if (map.has(g)) ordered.set(g, map.get(g)!); }
    for (const [g, ps] of map) { if (!ordered.has(g)) ordered.set(g, ps); }
    return ordered;
  }, [data]);

  // Emite grupoTotales al padre para que calcule capacidad real y bottleneck
  useEffect(() => {
    if (!data) return;
    const gt: Record<string, Record<string, number>> = {};
    for (const [grupo, equipo] of grupos.entries()) {
      gt[grupo] = {};
      for (const sem of data.semanas) {
        gt[grupo][sem] = equipo.reduce((acc, p) => acc + getVal(valores, p.id, sem), 0);
      }
    }
    onStatsChange?.({ grupoTotales: gt, semanas: data.semanas });
  }, [valores, data, grupos]); // eslint-disable-line react-hooks/exhaustive-deps

  // bottleneck por semana: cuál de los grupos limitantes tiene el mínimo
  const bottleneckPorSemana = useMemo((): Record<string, string> => {
    if (!data) return {};
    const result: Record<string, string> = {};
    for (const sem of data.semanas) {
      let minVal = Infinity;
      let minGrupo = "";
      for (const g of GRUPOS_BOTTLENECK) {
        const suma = (grupos.get(g) ?? []).reduce((acc, p) => acc + getVal(valores, p.id, sem), 0);
        if (suma < minVal) { minVal = suma; minGrupo = g; }
      }
      result[sem] = minGrupo;
    }
    return result;
  }, [valores, data, grupos]);

  function toggleCargo(cargo: string) {
    setColapsados(prev => { const s = new Set(prev); s.has(cargo) ? s.delete(cargo) : s.add(cargo); return s; });
  }
  function colapsarTodo() { setColapsados(new Set(grupos.keys())); }
  function expandirTodo()  { setColapsados(new Set()); }

  // Edición individual con debounce
  function handleChange(personaId: string, semana: string, raw: string) {
    const v = Math.max(0, Math.min(10, parseInt(raw) || 0));
    setValores(prev => ({ ...prev, [personaId]: { ...(prev[personaId] ?? {}), [semana]: v } }));
    const key = `${personaId}:${semana}`;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => { upsertCapacity(supabase, personaId, semana, v); }, 800);
  }

  // ── Edición masiva: grupo × todas las semanas ──────────────
  async function handleBulkCapacityUpdate(grupo: string, capacidad: number) {
    if (!data) return;
    const equipo  = grupos.get(grupo) ?? [];
    const ids     = equipo.map(p => p.id);
    const semanas = data.semanas;

    // 1. Actualizar estado local inmediatamente
    setValores(prev => {
      const next = { ...prev };
      for (const pid of ids) {
        next[pid] = { ...(next[pid] ?? {}) };
        for (const sem of semanas) next[pid][sem] = capacidad;
      }
      return next;
    });

    // 2. Flash verde en todas las celdas del grupo
    const keys = new Set(ids.flatMap(pid => semanas.map(sem => `${pid}:${sem}`)));
    setFlashCells(keys);
    setTimeout(() => setFlashCells(new Set()), 1200);

    // 3. Persistir en Supabase (chunked upsert)
    await upsertCapacityBulkAll(supabase, ids, semanas, capacidad);
  }

  // ── Edición por persona con alcance (año o meses seleccionados) ──
  async function handlePersonaCapacityUpdate(
    persona: PersonaCapacity,
    semanasFiltradas: string[],
    capacidad: number
  ) {
    setLoadingPersona(persona.id);

    // 1. Actualizar estado local
    setValores(prev => {
      const next = { ...prev, [persona.id]: { ...(prev[persona.id] ?? {}) } };
      for (const sem of semanasFiltradas) next[persona.id][sem] = capacidad;
      return next;
    });

    // 2. Flash en celdas afectadas
    const keys = new Set(semanasFiltradas.map(sem => `${persona.id}:${sem}`));
    setFlashCells(keys);
    setTimeout(() => setFlashCells(new Set()), 1200);

    // 3. Persistir — reutiliza upsertCapacityBulkAll con un solo personaId
    await upsertCapacityBulkAll(supabase, [persona.id], semanasFiltradas, capacidad);

    setLoadingPersona(null);
    // El recálculo de totales y capacidad real se dispara automáticamente
    // por el useEffect que observa [valores, data, grupos]
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-[#888]">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando capacity...</span>
      </div>
    );
  }
  if (!data) return null;

  const { semanas } = data;
  const CELL_W = 52;

  return (
    <div className="h-full flex flex-col">

      {/* Barra superior */}
      <div className="flex items-center justify-end px-4 py-2 border-b border-[#f0f0f0] flex-shrink-0">
        <button
          onClick={colapsados.size >= grupos.size ? expandirTodo : colapsarTodo}
          className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e8e8e8] text-[#888] hover:text-[#555] hover:bg-[#f5f5f5] transition-colors"
        >
          {colapsados.size >= grupos.size ? "Expandir todo" : "Colapsar todo"}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-[12px]" style={{ minWidth: `${220 + semanas.length * CELL_W}px` }}>

          {/* Encabezados */}
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 bg-[#fafafa] border-b border-r border-[#ebebeb]" style={{ minWidth: 220, width: 220 }} />
              {semanas.map((sem) => {
                const esPrimero = esPrimerLunesMes(sem);
                const { mes } = labelSemana(sem);
                return (
                  <th key={`mes-${sem}`}
                    className={`bg-[#fafafa] border-b border-[#ebebeb] px-1 py-1 text-center ${esPrimero ? "border-l-2 border-l-[#d1d5db]" : ""}`}
                    style={{ minWidth: CELL_W, width: CELL_W }}
                  >
                    {esPrimero && <span className="text-[9px] font-bold text-[#6b7280] uppercase tracking-wide">{mes}</span>}
                  </th>
                );
              })}
            </tr>
            <tr>
              <th className="sticky left-0 z-30 bg-[#fafafa] border-b border-r border-[#ebebeb] px-4 py-2 text-left text-[11px] font-semibold text-[#888] uppercase tracking-wide" style={{ minWidth: 220, width: 220 }}>
                Persona
              </th>
              {semanas.map((sem) => {
                const esPrimero = esPrimerLunesMes(sem);
                const { semana } = labelSemana(sem);
                return (
                  <th key={sem}
                    className={`bg-[#fafafa] border-b border-[#ebebeb] py-2 text-center ${esPrimero ? "border-l-2 border-l-[#d1d5db]" : ""}`}
                    style={{ minWidth: CELL_W, width: CELL_W }}
                  >
                    <span className="text-[10px] text-[#888] font-semibold">{semana}</span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {Array.from(grupos.entries()).map(([cargo, equipo]) => {
              const colapsado = colapsados.has(cargo);
              return (
                <React.Fragment key={cargo}>

                  {/* ── Cabecera de cargo ── */}
                  <tr className="bg-[#f0f0f0] border-t-2 border-b border-[#ddd]">
                    <td className="sticky left-0 z-10 bg-[#f0f0f0] border-r border-[#ddd] px-2 py-1.5" style={{ minWidth: 220, width: 220 }}>
                      <div className="flex items-center justify-between gap-1">
                        <button
                          onClick={() => toggleCargo(cargo)}
                          className="flex items-center gap-1.5 min-w-0 hover:opacity-70 transition-opacity"
                        >
                          {colapsado
                            ? <ChevronRight className="w-3 h-3 text-[#777] flex-shrink-0" />
                            : <ChevronDown  className="w-3 h-3 text-[#777] flex-shrink-0" />}
                          <span className="text-[10px] font-bold text-[#444] uppercase tracking-wide truncate">{cargo}</span>
                          <span className="text-[9px] text-[#aaa] ml-1 flex-shrink-0">· {equipo.length}</span>
                        </button>

                        {/* Botón Set Capacity */}
                        <button
                          onClick={() => setBulkGrupo(cargo)}
                          title={`Set capacity para todos los ${cargo}`}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white border border-[#d1d5db] text-[9px] font-semibold text-[#555] hover:bg-[#2563eb] hover:text-white hover:border-[#2563eb] transition-colors flex-shrink-0"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                          Set
                        </button>
                      </div>
                    </td>
                    {semanas.map((sem) => (
                      <td key={sem}
                        className={esPrimerLunesMes(sem) ? "border-l-2 border-l-[#d1d5db]" : ""}
                        style={{ minWidth: CELL_W, width: CELL_W }}
                      />
                    ))}
                  </tr>

                  {/* ── Filas de personas ── */}
                  {!colapsado && equipo.map((p, idx) => {
                    const isLoadingRow = loadingPersona === p.id;
                    return (
                      <tr key={p.id} className={`${idx % 2 === 0 ? "bg-white" : "bg-[#fafafa]"} ${isLoadingRow ? "opacity-60" : ""} transition-opacity`}>
                        <td className="sticky left-0 z-10 bg-inherit border-r border-[#ebebeb] px-3 py-1" style={{ minWidth: 220, width: 220 }}>
                          <div className="flex items-center gap-1.5">
                            {isLoadingRow
                              ? <Loader2 className="w-3 h-3 animate-spin text-[#2563eb] flex-shrink-0" />
                              : (
                                <button
                                  onClick={() => setPersonaEdit(p)}
                                  title="Editar capacidad"
                                  className="p-0.5 rounded hover:bg-[#e8e8e8] text-[#ddd] hover:text-[#2563eb] transition-colors flex-shrink-0"
                                >
                                  <Pencil className="w-2.5 h-2.5" />
                                </button>
                              )
                            }
                            <span className="text-[12px] font-medium text-[#1a1a1a] truncate">
                              {p.nombre} {p.apellido}
                            </span>
                          </div>
                        </td>
                        {semanas.map((sem) => {
                          const v     = getVal(valores, p.id, sem);
                          const flash = flashCells.has(`${p.id}:${sem}`);
                          const esPrimero = esPrimerLunesMes(sem);
                          return (
                            <td key={sem}
                              className={`py-1 px-1 text-center border-b border-[#f5f5f5] ${esPrimero ? "border-l-2 border-l-[#d1d5db]" : ""}`}
                              style={{ minWidth: CELL_W, width: CELL_W }}
                            >
                              <input
                                type="number"
                                min={0} max={10}
                                value={v}
                                onChange={(e) => handleChange(p.id, sem, e.target.value)}
                                onFocus={(e) => e.target.select()}
                                className="w-9 text-center text-[11px] font-bold rounded border py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2563eb] focus:border-[#2563eb] transition-all duration-300"
                                style={{
                                  background:   cellColor(v, flash),
                                  color:        cellText(v, flash),
                                  borderColor:  flash ? "#6ee7b7" : v === 0 ? "#e5e7eb" : "#bfdbfe",
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}

                  {/* ── Fila total (expandido) ── */}
                  {!colapsado && (
                    <tr className="bg-[#f4f4f4] border-t border-b border-[#e0e0e0]">
                      <td className="sticky left-0 z-10 bg-[#f4f4f4] border-r border-[#e0e0e0] px-4 py-1" style={{ minWidth: 220, width: 220 }}>
                        <span className="text-[10px] font-bold text-[#555] uppercase tracking-wide">Total · {cargo}</span>
                      </td>
                      {semanas.map((sem) => {
                        const suma       = equipo.reduce((acc, p) => acc + getVal(valores, p.id, sem), 0);
                        const esBottle   = GRUPOS_BOTTLENECK.includes(cargo) && bottleneckPorSemana[sem] === cargo;
                        const esPrimero  = esPrimerLunesMes(sem);
                        return (
                          <td key={sem}
                            className={`py-1 text-center ${esPrimero ? "border-l-2 border-l-[#d1d5db]" : ""}`}
                            style={{ minWidth: CELL_W, width: CELL_W }}
                          >
                            <span
                              className="text-[11px] font-bold px-1 rounded"
                              style={esBottle
                                ? { color: "#dc2626", background: "#fee2e2" }  // rojo = cuello de botella
                                : { color: "#1d4ed8" }}
                              title={esBottle ? "Cuello de botella esta semana" : undefined}
                            >
                              {suma}
                            </span>
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

      {/* Modal edición masiva */}
      {bulkGrupo && (
        <BulkEditModal
          grupo={bulkGrupo}
          onConfirm={(v) => handleBulkCapacityUpdate(bulkGrupo, v)}
          onClose={() => setBulkGrupo(null)}
        />
      )}

      {/* Modal edición por persona */}
      {personaEdit && data && (
        <PersonaEditModal
          persona={personaEdit}
          semanas={data.semanas}
          onConfirm={(semanasFiltradas, capacidad) =>
            handlePersonaCapacityUpdate(personaEdit, semanasFiltradas, capacidad)
          }
          onClose={() => setPersonaEdit(null)}
        />
      )}
    </div>
  );
}
