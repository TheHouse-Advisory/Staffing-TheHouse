"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, History, LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { BOXES, getTalentBoxIndex, TalentMatrix, type PinHistorico } from "./TalentMatrix";
import { CARGO_COLORS, CARGO_COLOR_DEFAULT } from "@/lib/constants";
import { SelectorMatriz9Box } from "./SelectorMatriz9Box";
import { cargoEnFecha, type PeriodoCargo } from "./PersonaRemuneracionesTimeline";

// Fila de persona_matriz_hito (RLS: solo admin/personas). cuadrante = índice en BOXES
interface HitoMatriz {
  id: string;
  fecha: string;
  cargo: string | null;
  cuadrante: number;
  potencial: number | null; // pin exacto (1-5); null en registros antiguos
  desempeno: number | null;
  comentario: string | null;
}

type HitoDraft = Omit<HitoMatriz, "id" | "cuadrante"> & { id?: string; cuadrante: number | null };

interface Props {
  personaId: string;
  cargoActual?: string | null;
  cargosSugeridos?: readonly string[];
  /** Historial de Desarrollo de Carrera, para autocompletar el cargo según la fecha */
  historialCargos?: PeriodoCargo[];
}

// Centro (escala 1-5) de cada cuadrante, para registros antiguos sin pin exacto
const CENTRO = [13 / 3, 3, 5 / 3]; // potencial por fila (0 = alto); desempeño usa CENTRO[2 - col]
const centroCuadrante = (i: number) => ({ potencial: CENTRO[Math.floor(i / 3)], desempeno: CENTRO[2 - (i % 3)] });

// Hitos → pines: color según cargo a esa fecha; pines en el mismo punto se apilan
function pinesDesdeHitos(hitos: HitoMatriz[], actualId: string | null = hitos.at(-1)?.id ?? null): PinHistorico[] {
  const usados = new Map<string, number>();
  return hitos.map((h, idx) => {
    const pos = h.potencial != null && h.desempeno != null
      ? { potencial: Number(h.potencial), desempeno: Number(h.desempeno) }
      : centroCuadrante(h.cuadrante);
    const clave = `${pos.potencial.toFixed(1)}|${pos.desempeno.toFixed(1)}`;
    const n = usados.get(clave) ?? 0;
    usados.set(clave, n + 1);
    const fecha = parseISO(h.fecha);
    return {
      id: h.id,
      ...pos,
      color: CARGO_COLORS[h.cargo ?? ""] ?? CARGO_COLOR_DEFAULT,
      etiqueta: format(fecha, "d/MMM", { locale: es }), // ej. "6/oct"
      detalle: `${format(fecha, "d MMM yyyy", { locale: es })} · ${h.cargo || "Sin cargo"}`,
      actual: h.id === actualId,
      offsetY: n * 36, // alto aprox. de pin + fecha
    };
  });
}

const inputCls = "w-full text-sm px-3 py-1.5 rounded-lg border border-[#e8e8e8] outline-none focus:border-[#1a1a2e] bg-white";

// Tarjeta de un hito: título (badge color cuadrante) → cargo → fecha → comentario
function TarjetaHito({ h, actual, onEditar, onEliminar }: {
  h: HitoMatriz;
  actual: boolean;
  onEditar: (h: HitoMatriz) => void;
  onEliminar: (id: string) => void;
}) {
  const box = BOXES[h.cuadrante];
  return (
    <div
      className="group relative shrink-0 w-56 border rounded-lg p-4 bg-white/50"
      style={{ borderColor: actual ? "#93c5fd" : "#e8e8e8", boxShadow: actual ? "0 0 0 3px rgba(59,130,246,0.10)" : "none" }}
    >
      {/* Acciones (hover) */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEditar(h)} className="p-1 rounded hover:bg-[#f5f5f5] text-[#888] hover:text-[#1a1a1a]" title="Editar evaluación">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onEliminar(h.id)} className="p-1 rounded hover:bg-red-50 text-[#888] hover:text-red-500" title="Eliminar evaluación">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {box && (
        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md mr-12" style={{ background: box.bg, color: box.text }} title={box.sub}>
          {box.title}
        </span>
      )}
      <p className="text-xs text-[#555] mt-2">{h.cargo || "Sin cargo"}</p>
      <div className="flex items-center gap-2 flex-wrap mt-1">
        <span className="text-[11px] text-[#60a5fa] font-medium capitalize">
          {format(parseISO(h.fecha), "d MMM yyyy", { locale: es })}
        </span>
        {actual && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white uppercase tracking-wide">Actual</span>
        )}
      </div>
      {h.comentario && <p className="text-[11px] text-[#9ca3af] italic mt-1 break-words">{h.comentario}</p>}
    </div>
  );
}

// Carpeta de un año (mismo diseño que EPP y EDD): tarjetas + matriz 9-box con los pines del año
function CarpetaAnioMatriz({ anio, hitos, abiertaInicial, actualId, onEditar, onEliminar }: {
  anio: string;
  hitos: HitoMatriz[];
  abiertaInicial: boolean;
  actualId: string | null;
  onEditar: (h: HitoMatriz) => void;
  onEliminar: (id: string) => void;
}) {
  const [abierta, setAbierta] = useState(abiertaInicial);
  const [vista, setVista] = useState<"timeline" | "matriz">("timeline"); // vista independiente por año
  const scrollRef = useRef<HTMLDivElement>(null);
  // Scroll inicia en el hito más reciente del año
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [hitos, abierta, vista]);

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
          {hitos.length} evaluaci{hitos.length === 1 ? "ón" : "ones"}
        </span>
      </button>
      {abierta && (
        <div className="px-3 pb-3 pt-1 space-y-4">
          {hitos.length === 0 ? (
            <p className="text-[12px] text-[#ccc] italic">Sin evaluaciones este año.</p>
          ) : (
            <>
              {/* Toggle de vista dentro de la carpeta: línea temporal / matriz 9-box del año */}
              <div className="flex justify-end">
                <div className="flex items-center border border-[#e8e8e8] rounded-md overflow-hidden">
                  {([
                    { v: "timeline", icon: History, title: "Línea temporal de evolución" },
                    { v: "matriz", icon: LayoutGrid, title: "Matriz 9-box" },
                  ] as const).map(({ v, icon: Icon, title }) => (
                    <button
                      key={v}
                      type="button"
                      title={title}
                      onClick={() => setVista(v)}
                      className={`p-1 transition-colors ${vista === v ? "bg-[#f0f0f0] text-[#1a1a2e]" : "text-[#aaa] hover:bg-[#f5f5f5]"}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>
              {vista === "timeline" ? (
                <div ref={scrollRef} className="flex flex-row overflow-x-auto gap-4 pb-2">
                  {hitos.map((h) => (
                    <TarjetaHito key={h.id} h={h} actual={h.id === actualId} onEditar={onEditar} onEliminar={onEliminar} />
                  ))}
                </div>
              ) : (
                // Matriz 9-box con los pines del año (solo lectura)
                <div className="max-w-xl">
                  <TalentMatrix potencial={null} desempeno={null} isEditable={false} pines={pinesDesdeHitos(hitos, actualId)} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PersonaMatrizTimeline({ personaId, cargoActual, cargosSugeridos = [], historialCargos = [] }: Props) {
  const [hitos, setHitos] = useState<HitoMatriz[]>([]);
  const [draft, setDraft] = useState<HitoDraft | null>(null); // null = formulario cerrado
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    createAnyClient()
      .from("persona_matriz_hito")
      .select("id, fecha, cargo, cuadrante, potencial, desempeno, comentario")
      .eq("persona_id", personaId)
      .order("fecha", { ascending: true })
      .then(({ data }: { data: HitoMatriz[] | null }) => setHitos(data ?? []));
  }, [personaId]);


  const ordenar = (lista: HitoMatriz[]) => [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha));

  function nuevo() {
    setError(null);
    const hoy = format(new Date(), "yyyy-MM-dd");
    setDraft({ fecha: hoy, cargo: cargoEnFecha(historialCargos, hoy) ?? cargoActual ?? null, cuadrante: null, potencial: null, desempeno: null, comentario: null });
  }

  async function guardar() {
    if (!draft || !draft.fecha || draft.cuadrante == null) {
      setError("Fecha y posición en la matriz son obligatorias (haz clic en la matriz).");
      return;
    }
    setGuardando(true);
    setError(null);
    const { id, ...campos } = draft;
    const sb = createAnyClient();
    const { data, error } = id
      ? await sb.from("persona_matriz_hito").update(campos).eq("id", id).select().single()
      : await sb.from("persona_matriz_hito").insert({ ...campos, persona_id: personaId }).select().single();
    setGuardando(false);
    if (error || !data) { setError("No se pudo guardar. Intenta nuevamente."); return; }
    setHitos((prev) => ordenar([...prev.filter((h) => h.id !== data.id), data as HitoMatriz]));
    setDraft(null);
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar esta evaluación de matriz?")) return;
    const { error } = await createAnyClient().from("persona_matriz_hito").delete().eq("id", id);
    if (!error) setHitos((prev) => prev.filter((h) => h.id !== id));
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        {!draft && (
          <button
            onClick={nuevo}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#555] hover:bg-[#f5f5f5] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar evaluación de matriz
          </button>
        )}
      </div>

      {/* Formulario agregar/editar */}
      {draft && (
        <div className="mb-4 p-4 rounded-lg bg-[#fafafa] border border-[#f0f0f0] grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              list="cargos-matriz"
              value={draft.cargo ?? ""}
              onChange={(e) => setDraft({ ...draft, cargo: e.target.value || null })}
              className={inputCls}
            />
            <datalist id="cargos-matriz">
              {cargosSugeridos.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          {/* div (no label): un label con varios botones dispararía clics no deseados */}
          <div className="space-y-1 sm:col-span-3">
            <span className="text-[11px] text-[#888]">
              Posición en la matriz{draft.cuadrante != null && <> · <b className="text-[#1a1a1a]">{BOXES[draft.cuadrante].title}</b></>}
            </span>
            <SelectorMatriz9Box
              potencial={draft.potencial != null ? Number(draft.potencial) : null}
              desempeno={draft.desempeno != null ? Number(draft.desempeno) : null}
              // El pin define la posición exacta; el cuadrante (título) se deriva de ella
              onChange={(potencial, desempeno) => setDraft({ ...draft, potencial, desempeno, cuadrante: getTalentBoxIndex(potencial, desempeno) })}
            />
          </div>
          <label className="space-y-1 sm:col-span-3">
            <span className="text-[11px] text-[#888]">Comentario (opcional)</span>
            <textarea
              rows={2}
              value={draft.comentario ?? ""}
              onChange={(e) => setDraft({ ...draft, comentario: e.target.value || null })}
              className={`${inputCls} resize-none`}
            />
          </label>
          {error && <p className="sm:col-span-3 text-xs text-red-500">{error}</p>}
          <div className="sm:col-span-3 flex justify-end gap-2">
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

      {/* Carpetas por año (más reciente primero; el año en curso existe siempre) */}
      {(() => {
        const porAnio = new Map<string, HitoMatriz[]>();
        for (const h of hitos) {
          const anio = h.fecha.slice(0, 4);
          porAnio.set(anio, [...(porAnio.get(anio) ?? []), h]);
        }
        const anioActual = String(new Date().getFullYear());
        if (!porAnio.has(anioActual)) porAnio.set(anioActual, []);
        const anios = [...porAnio.keys()].sort((a, b) => b.localeCompare(a));
        const actualId = hitos.at(-1)?.id ?? null;
        return (
          <div className="space-y-2">
            {anios.map((anio, i) => (
              <CarpetaAnioMatriz
                key={anio}
                anio={anio}
                hitos={porAnio.get(anio)!}
                abiertaInicial={i === 0}
                actualId={actualId}
                onEditar={(h) => { setError(null); setDraft({ ...h }); }}
                onEliminar={eliminar}
              />
            ))}
          </div>
        );
      })()}
    </div>
  );
}
