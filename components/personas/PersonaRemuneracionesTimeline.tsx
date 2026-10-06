"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";

export const MONEDAS = ["CLP", "USD", "EUR", "UF"];

export function formatearMonto(monto: number | null, moneda: string): string {
  if (monto == null) return "—";
  // UF no es código ISO: se formatea como número con sufijo
  if (moneda === "UF") return `${monto.toLocaleString("es-CL", { maximumFractionDigits: 2 })} UF`;
  return monto.toLocaleString("es-CL", { style: "currency", currency: moneda, maximumFractionDigits: moneda === "CLP" ? 0 : 2 });
}

// Fila de persona_remuneracion_hito (RLS: solo admin/personas)
interface Hito {
  id: string;
  fecha_inicio: string;
  cargo: string | null;
  monto: number;
  moneda: string;
  nota: string | null;
}

type HitoDraft = Omit<Hito, "id" | "monto"> & { id?: string; monto: number | null };

interface Props {
  personaId: string;
  /** Moneda por defecto para hitos nuevos */
  monedaDefault: string;
  /** Cargo actual de la persona (prellenado en hitos nuevos) */
  cargoActual?: string | null;
  /** Sugerencias para el campo cargo */
  cargosSugeridos?: readonly string[];
  /** Historial de Desarrollo de Carrera (fechas yyyy-MM-dd; fechaFin "Presente" si sigue vigente) */
  historialCargos?: PeriodoCargo[];
}

export interface PeriodoCargo {
  cargo: string;
  fechaInicio: string;
  fechaFin: string;
}

// Cargo vigente en una fecha (si hay solapes, gana el periodo que empezó más tarde)
function cargoEnFecha(historial: PeriodoCargo[], fecha: string): string | null {
  const vigentes = historial.filter(
    (p) => p.fechaInicio <= fecha && (p.fechaFin === "Presente" || fecha <= p.fechaFin)
  );
  if (vigentes.length === 0) return null;
  return vigentes.reduce((a, b) => (b.fechaInicio > a.fechaInicio ? b : a)).cargo;
}

const inputCls = "w-full text-sm px-3 py-1.5 rounded-lg border border-[#e8e8e8] outline-none focus:border-[#1a1a2e] bg-white";

export function PersonaRemuneracionesTimeline({ personaId, monedaDefault, cargoActual, cargosSugeridos = [], historialCargos = [] }: Props) {
  const [hitos, setHitos] = useState<Hito[]>([]);
  const [draft, setDraft] = useState<HitoDraft | null>(null); // null = formulario cerrado
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createAnyClient()
      .from("persona_remuneracion_hito")
      .select("id, fecha_inicio, cargo, monto, moneda, nota")
      .eq("persona_id", personaId)
      .order("fecha_inicio", { ascending: true })
      .then(({ data }: { data: Hito[] | null }) => setHitos(data ?? []));
  }, [personaId]);

  // Orden ascendente (más antiguo primero, ACTUAL al final)
  const ordenar = (lista: Hito[]) => [...lista].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));

  // Al cargar/cambiar hitos, desplaza al extremo derecho para mostrar el hito ACTUAL
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [hitos]);

  function nuevo() {
    setError(null);
    const hoy = format(new Date(), "yyyy-MM-dd");
    setDraft({
      fecha_inicio: hoy,
      cargo: cargoEnFecha(historialCargos, hoy) ?? cargoActual ?? null,
      monto: null,
      moneda: monedaDefault,
      nota: null,
    });
  }

  async function guardar() {
    if (!draft || !draft.fecha_inicio || draft.monto == null) {
      setError("Fecha y monto son obligatorios.");
      return;
    }
    setGuardando(true);
    setError(null);
    const { id, ...campos } = draft;
    const sb = createAnyClient();
    const { data, error } = id
      ? await sb.from("persona_remuneracion_hito").update(campos).eq("id", id).select().single()
      : await sb.from("persona_remuneracion_hito").insert({ ...campos, persona_id: personaId }).select().single();
    setGuardando(false);
    if (error || !data) { setError("No se pudo guardar. Intenta nuevamente."); return; }
    setHitos((prev) => ordenar([...prev.filter((h) => h.id !== data.id), data as Hito]));
    setDraft(null);
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar este hito de remuneración?")) return;
    const { error } = await createAnyClient().from("persona_remuneracion_hito").delete().eq("id", id);
    if (!error) setHitos((prev) => prev.filter((h) => h.id !== id));
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-semibold">Línea temporal</h4>
          <p className="text-xs text-[#aaa] mt-0.5">Evolución de la remuneración</p>
        </div>
        {!draft && (
          <button
            onClick={nuevo}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#555] hover:bg-[#f5f5f5] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar hito
          </button>
        )}
      </div>

      {/* Formulario agregar/editar */}
      {draft && (
        <div className="mb-5 p-4 rounded-lg bg-[#fafafa] border border-[#f0f0f0] grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[11px] text-[#888]">Fecha de inicio</span>
            <input type="date" value={draft.fecha_inicio} onChange={(e) => {
                const fecha = e.target.value;
                // Autocompleta el cargo según Desarrollo de Carrera; si no hay match, conserva el actual (editable)
                const cargo = fecha ? cargoEnFecha(historialCargos, fecha) : null;
                setDraft({ ...draft, fecha_inicio: fecha, cargo: cargo ?? draft.cargo });
              }} className={inputCls} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-[#888]">Cargo a esa fecha</span>
            <input
              list="cargos-remuneracion"
              value={draft.cargo ?? ""}
              onChange={(e) => setDraft({ ...draft, cargo: e.target.value || null })}
              className={inputCls}
            />
            <datalist id="cargos-remuneracion">
              {cargosSugeridos.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-[#888]">Monto</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={draft.monto ?? ""}
                onChange={(e) => setDraft({ ...draft, monto: e.target.value === "" ? null : Number(e.target.value) })}
                className={inputCls}
              />
              <select value={draft.moneda} onChange={(e) => setDraft({ ...draft, moneda: e.target.value })} className={`${inputCls} w-24`}>
                {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {draft.monto != null && <span className="text-[11px] text-[#aaa]">{formatearMonto(draft.monto, draft.moneda)}</span>}
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-[#888]">Nota / Motivo (opcional)</span>
            <input
              value={draft.nota ?? ""}
              onChange={(e) => setDraft({ ...draft, nota: e.target.value || null })}
              placeholder="Ej: Aumento por desempeño, Promoción"
              className={inputCls}
            />
          </label>
          {error && <p className="sm:col-span-2 text-xs text-red-500">{error}</p>}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button
              onClick={() => { setDraft(null); setError(null); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#888] hover:bg-white transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a2e] text-white hover:bg-[#2d2d4e] transition-colors disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}

      {/* Hitos en tarjetas horizontales (antiguo → reciente; scroll inicia en el ACTUAL) */}
      {hitos.length === 0 ? (
        <p className="text-[12px] text-[#ccc] italic py-2">Sin hitos registrados aún.</p>
      ) : (
        <div ref={scrollRef} className="flex flex-row overflow-x-auto gap-4 pb-2">
          {hitos.map((h, idx) => {
            const actual = idx === hitos.length - 1;
            return (
              <div
                key={h.id}
                className="group relative shrink-0 w-56 border rounded-lg p-4 bg-white/50"
                style={{ borderColor: actual ? "#93c5fd" : "#e8e8e8", boxShadow: actual ? "0 0 0 3px rgba(59,130,246,0.10)" : "none" }}
              >
                {/* Acciones (hover) */}
                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setError(null); setDraft({ ...h }); }}
                    className="p-1 rounded hover:bg-[#f5f5f5] text-[#888] hover:text-[#1a1a1a]"
                    title="Editar hito"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => eliminar(h.id)}
                    className="p-1 rounded hover:bg-red-50 text-[#888] hover:text-red-500"
                    title="Eliminar hito"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Orden: cargo → monto → fecha/badge → nota */}
                <p className="text-sm font-semibold text-[#1a1a1a] pr-14 break-words">{h.cargo || "Sin cargo"}</p>
                <p className="text-sm font-semibold mt-1" style={{ color: actual ? "#1d4ed8" : "#374151" }}>
                  {formatearMonto(h.monto, h.moneda)}
                </p>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <span className="text-[11px] text-[#60a5fa] font-medium capitalize">
                    {format(parseISO(h.fecha_inicio), "d MMM yyyy", { locale: es })}
                  </span>
                  {actual && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white uppercase tracking-wide">Actual</span>
                  )}
                </div>
                {h.nota && <p className="text-[11px] text-[#9ca3af] italic mt-1 break-words">{h.nota}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
