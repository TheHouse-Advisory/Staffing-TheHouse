"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutGrid, LineChart, Pencil, Plus, Trash2, type LucideIcon } from "lucide-react";
import { EvaluacionesChart } from "./EvaluacionesChart";
import { cargoEnFecha, type PeriodoCargo } from "./PersonaRemuneracionesTimeline";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";

// Fila de persona_evaluacion (RLS: solo admin/personas)
interface Evaluacion {
  id: string;
  tipo: "EPP" | "EDD";
  fecha: string;
  nota: number;
  cargo: string | null;
  comentario: string | null;
}

type EvaluacionDraft = Omit<Evaluacion, "id" | "nota"> & { id?: string; nota: number | null };

// Escala chilena 1.0 – 7.0
const NOTA_MIN = 1;
const NOTA_MAX = 7;

// Color del badge según nota (≥6 alto, ≥4 medio, <4 bajo)
function colorNota(nota: number): string {
  if (nota >= 6) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (nota >= 4) return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-red-50 text-red-600 border-red-200";
}

// Orden de las filas: EDD arriba, EPP abajo
const TIPOS = ["EDD", "EPP"] as const;

function BotonVista({ icon: Icon, title, activo, onClick }: { icon: LucideIcon; title: string; activo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`p-1 transition-colors ${activo ? "bg-[#f0f0f0] text-[#1a1a2e]" : "text-[#aaa] hover:bg-[#f5f5f5]"}`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

// Tarjeta individual: nota (badge) + cargo → fecha → comentario
function TarjetaEvaluacion({ ev, ultima, onEditar, onEliminar }: {
  ev: Evaluacion;
  ultima: boolean;
  onEditar: (ev: Evaluacion) => void;
  onEliminar: (id: string) => void;
}) {
  return (
    <div
      className="group relative shrink-0 w-56 border rounded-lg p-4 bg-white/50"
      style={{ borderColor: ultima ? "#93c5fd" : "#e8e8e8", boxShadow: ultima ? "0 0 0 3px rgba(59,130,246,0.10)" : "none" }}
    >
      {/* Acciones (hover) */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEditar(ev)} className="p-1 rounded hover:bg-[#f5f5f5] text-[#888] hover:text-[#1a1a1a]" title="Editar evaluación">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onEliminar(ev.id)} className="p-1 rounded hover:bg-red-50 text-[#888] hover:text-red-500" title="Eliminar evaluación">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2 pr-12">
        <span className={`shrink-0 text-lg font-bold px-2.5 py-0.5 rounded-lg border tabular-nums ${colorNota(ev.nota)}`}>
          {Number(ev.nota).toFixed(1)}
        </span>
        <span className="text-xs text-[#555] leading-tight break-words">{ev.cargo || "Sin cargo"}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <span className="text-[11px] text-[#60a5fa] font-medium capitalize">
          {format(parseISO(ev.fecha), "d MMM yyyy", { locale: es })}
        </span>
        {ultima && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white uppercase tracking-wide">Última</span>
        )}
      </div>
      {ev.comentario && <p className="text-[11px] text-[#9ca3af] italic mt-1 break-words">{ev.comentario}</p>}
    </div>
  );
}

// Bloque de un tipo (EDD/EPP) dentro de un año: toggle tarjetas/gráfico + fila horizontal
function FilaTipo({ titulo, evaluaciones, ultimaId, onEditar, onEliminar }: {
  titulo: string;
  evaluaciones: Evaluacion[];
  ultimaId: string | null;
  onEditar: (ev: Evaluacion) => void;
  onEliminar: (id: string) => void;
}) {
  const [vista, setVista] = useState<"tarjetas" | "grafico">("tarjetas");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Scroll inicia en la evaluación más reciente
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [evaluaciones, vista]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-[#555]">{titulo}</p>
        {evaluaciones.length > 0 && (
          <div className="flex items-center border border-[#e8e8e8] rounded-md overflow-hidden">
            <BotonVista icon={LayoutGrid} title="Vista de tarjetas" activo={vista === "tarjetas"} onClick={() => setVista("tarjetas")} />
            <BotonVista icon={LineChart} title="Gráfico de evolución" activo={vista === "grafico"} onClick={() => setVista("grafico")} />
          </div>
        )}
      </div>
      {evaluaciones.length === 0 ? (
        <p className="text-[12px] text-[#ccc] italic">Sin evaluaciones este año.</p>
      ) : vista === "grafico" ? (
        <EvaluacionesChart datos={evaluaciones} />
      ) : (
        <div ref={scrollRef} className="flex flex-row overflow-x-auto gap-4 pb-2">
          {evaluaciones.map((ev) => (
            <TarjetaEvaluacion key={ev.id} ev={ev} ultima={ev.id === ultimaId} onEditar={onEditar} onEliminar={onEliminar} />
          ))}
        </div>
      )}
    </div>
  );
}

// Carpeta principal de un año: contiene "Evaluaciones EDD" y "Evaluaciones EPP" de ese año
function CarpetaAnio({ anio, evaluaciones, abiertaInicial, ultimaPorTipo, onEditar, onEliminar }: {
  anio: string;
  evaluaciones: Evaluacion[];
  abiertaInicial: boolean;
  ultimaPorTipo: Record<Evaluacion["tipo"], string | null>;
  onEditar: (ev: Evaluacion) => void;
  onEliminar: (id: string) => void;
}) {
  const [abierta, setAbierta] = useState(abiertaInicial);
  return (
    <div className="border border-[#f0f0f0] rounded-lg">
      <button
        type="button"
        onClick={() => setAbierta((a) => !a)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#fafafa] rounded-lg transition-colors"
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold text-[#1a1a1a]">
          <ChevronDown className="w-4 h-4 text-gray-400 transition-transform" style={{ transform: abierta ? "none" : "rotate(-90deg)" }} />
          {anio}
        </span>
        <span className="text-[11px] text-[#aaa]">
          {evaluaciones.length} evaluaci{evaluaciones.length === 1 ? "ón" : "ones"}
        </span>
      </button>
      {abierta && (
        <div className="px-3 pb-3 pt-1 space-y-4">
          {TIPOS.map((tipo) => (
            <FilaTipo
              key={tipo}
              titulo={`Evaluaciones ${tipo}`}
              evaluaciones={evaluaciones.filter((e) => e.tipo === tipo)}
              ultimaId={ultimaPorTipo[tipo]}
              onEditar={onEditar}
              onEliminar={onEliminar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full text-sm px-3 py-1.5 rounded-lg border border-[#e8e8e8] outline-none focus:border-[#1a1a2e] bg-white";

interface Props {
  personaId: string;
  cargoActual?: string | null;
  cargosSugeridos?: readonly string[];
  /** Historial de Desarrollo de Carrera, para autocompletar el cargo según la fecha */
  historialCargos?: PeriodoCargo[];
}

export function PersonaEvaluacionesTimeline({ personaId, cargoActual, cargosSugeridos = [], historialCargos = [] }: Props) {
  const [evaluaciones, setEvaluaciones] = useState<Evaluacion[]>([]);
  const [draft, setDraft] = useState<EvaluacionDraft | null>(null); // null = formulario cerrado
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colapsada, setColapsada] = useState(false);

  useEffect(() => {
    createAnyClient()
      .from("persona_evaluacion")
      .select("id, tipo, fecha, nota, cargo, comentario")
      .eq("persona_id", personaId)
      .order("fecha", { ascending: true })
      .then(({ data }: { data: Evaluacion[] | null }) => setEvaluaciones(data ?? []));
  }, [personaId]);

  // Orden ascendente (más antigua primero)
  const ordenar = (lista: Evaluacion[]) => [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha));

  async function guardar() {
    if (!draft || !draft.fecha || draft.nota == null) {
      setError("Fecha y nota son obligatorias.");
      return;
    }
    if (draft.nota < NOTA_MIN || draft.nota > NOTA_MAX) {
      setError(`La nota debe estar entre ${NOTA_MIN} y ${NOTA_MAX}.`);
      return;
    }
    setGuardando(true);
    setError(null);
    const { id, ...campos } = draft;
    const sb = createAnyClient();
    const { data, error } = id
      ? await sb.from("persona_evaluacion").update(campos).eq("id", id).select().single()
      : await sb.from("persona_evaluacion").insert({ ...campos, persona_id: personaId }).select().single();
    setGuardando(false);
    if (error || !data) { setError("No se pudo guardar. Intenta nuevamente."); return; }
    setEvaluaciones((prev) => ordenar([...prev.filter((e) => e.id !== data.id), data as Evaluacion]));
    setDraft(null);
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar esta evaluación?")) return;
    const { error } = await createAnyClient().from("persona_evaluacion").delete().eq("id", id);
    if (!error) setEvaluaciones((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[#888]">EPP y EDD</h4>
        <div className="flex items-center gap-2">
        {!draft && (
          <button
            onClick={() => { setColapsada(false); setError(null); const hoy = format(new Date(), "yyyy-MM-dd"); setDraft({ tipo: "EDD", fecha: hoy, nota: null, cargo: cargoEnFecha(historialCargos, hoy) ?? cargoActual ?? null, comentario: null }); }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#555] hover:bg-[#f5f5f5] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar evaluación
          </button>
        )}
          {/* Colapsar / expandir la subsección */}
          <button
            onClick={() => setColapsada((c) => !c)}
            className="p-1 rounded hover:bg-[#f5f5f5] text-[#888] hover:text-[#1a1a1a] transition-colors"
            title={colapsada ? "Expandir EPP y EDD" : "Colapsar EPP y EDD"}
          >
            <ChevronDown className="w-4 h-4 transition-transform" style={{ transform: colapsada ? "rotate(-90deg)" : "none" }} />
          </button>
        </div>
      </div>

      {!colapsada && (<>
      {/* Formulario agregar/editar */}
      {draft && (
        <div className="mb-4 p-4 rounded-lg bg-[#fafafa] border border-[#f0f0f0] grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[11px] text-[#888]">Tipo</span>
            <select value={draft.tipo} onChange={(e) => setDraft({ ...draft, tipo: e.target.value as Evaluacion["tipo"] })} className={inputCls}>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-[#888]">Fecha de evaluación</span>
            <input
              type="date"
              value={draft.fecha}
              onChange={(e) => {
                const fecha = e.target.value;
                // Autocompleta el cargo según Desarrollo de Carrera; si no hay match, conserva el actual
                const cargo = fecha ? cargoEnFecha(historialCargos, fecha) : null;
                setDraft({ ...draft, fecha, cargo: cargo ?? draft.cargo });
              }}
              className={inputCls}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-[#888]">Cargo a esa fecha</span>
            <input
              list="cargos-evaluacion"
              value={draft.cargo ?? ""}
              onChange={(e) => setDraft({ ...draft, cargo: e.target.value || null })}
              className={inputCls}
            />
            <datalist id="cargos-evaluacion">
              {cargosSugeridos.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-[#888]">Nota ({NOTA_MIN} a {NOTA_MAX})</span>
            <input
              type="number"
              min={NOTA_MIN}
              max={NOTA_MAX}
              step={0.1}
              value={draft.nota ?? ""}
              onChange={(e) => setDraft({ ...draft, nota: e.target.value === "" ? null : Number(e.target.value) })}
              className={inputCls}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[11px] text-[#888]">Comentario</span>
            <textarea
              rows={2}
              value={draft.comentario ?? ""}
              onChange={(e) => setDraft({ ...draft, comentario: e.target.value || null })}
              className={`${inputCls} resize-none`}
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

      {/* Carpetas por año (más reciente primero); dentro, EDD arriba y EPP abajo */}
      {(() => {
        // Sin cargo guardado → se detecta desde Desarrollo de Carrera según la fecha
        const conCargo = evaluaciones.map((e) => e.cargo ? e : { ...e, cargo: cargoEnFecha(historialCargos, e.fecha) });
        const porAnio = new Map<string, Evaluacion[]>();
        for (const ev of conCargo) {
          const anio = ev.fecha.slice(0, 4);
          porAnio.set(anio, [...(porAnio.get(anio) ?? []), ev]);
        }
        // La carpeta del año en curso existe siempre (se crea sola al cambiar de año)
        const anioActual = String(new Date().getFullYear());
        if (!porAnio.has(anioActual)) porAnio.set(anioActual, []);
        const anios = [...porAnio.keys()].sort((a, b) => b.localeCompare(a));
        // Última evaluación global de cada tipo (badge "Última")
        const ultimaPorTipo = Object.fromEntries(
          TIPOS.map((t) => [t, evaluaciones.filter((e) => e.tipo === t).at(-1)?.id ?? null])
        ) as Record<Evaluacion["tipo"], string | null>;
        return (
          <div className="space-y-2">
            {anios.map((anio, i) => (
              <CarpetaAnio
                key={anio}
                anio={anio}
                evaluaciones={porAnio.get(anio)!}
                abiertaInicial={i === 0}
                ultimaPorTipo={ultimaPorTipo}
                onEditar={(ev) => { setError(null); setDraft({ ...ev }); }}
                onEliminar={eliminar}
              />
            ))}
          </div>
        );
      })()}
      </>)}
    </div>
  );
}
