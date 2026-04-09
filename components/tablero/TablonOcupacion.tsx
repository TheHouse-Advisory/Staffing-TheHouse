"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { format, addDays, startOfISOWeek } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchOcupacionSemanas,
  fetchOcupacionSemanasPlan,
  SEMANAS_VISIBLES,
  type FilaPersona,
} from "@/lib/queries/tablero";
import { colorOcupacion, formatPct } from "@/lib/utils";

interface Props {
  semanaInicio: Date;
  planId: string | null;
}

// ─────────────────────────────────────────────────────────────
//  Tipos del desglose de celda
// ─────────────────────────────────────────────────────────────

interface LineaDesglose {
  engagement_nombre: string;
  pct: number;
  tipo: "real" | "plan";
}

interface PopoverState {
  personaId: string;
  personaNombre: string;
  semanaKey: string;       // "yyyy-MM-dd"
  semanaLabel: string;
  pct: number;
  rect: DOMRect;
}

// ─────────────────────────────────────────────────────────────
//  Celdas de ocupación
// ─────────────────────────────────────────────────────────────

function CeldaOcupacion({
  pct, tieneAlerta, onClick,
}: {
  pct: number;
  tieneAlerta: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { bg, text } = colorOcupacion(pct);
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click para ver desglose"
      className="w-full h-9 rounded-md flex items-center justify-center text-xs font-semibold transition-all hover:opacity-80 hover:ring-2 hover:ring-offset-1 hover:ring-[#4a90e2] cursor-pointer relative"
      style={{ background: bg, color: pct === 0 ? "#888" : text }}
    >
      {pct === 0 ? "—" : formatPct(pct)}
      {tieneAlerta && (
        <span className="absolute -top-1 -right-1" title="Supera el 100%">
          <AlertTriangle className="w-3 h-3 text-red-500" />
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
//  Popover de desglose
// ─────────────────────────────────────────────────────────────

function DesglosePopover({
  state,
  planId,
  onClose,
}: {
  state: PopoverState;
  planId: string | null;
  onClose: () => void;
}) {
  const [lineas, setLineas] = useState<LineaDesglose[]>([]);
  const [loading, setLoading] = useState(true);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Cargar desglose de asignaciones para esa persona en esa semana
  useEffect(() => {
    const fechaInicio = state.semanaKey;
    const fechaFin = format(addDays(new Date(state.semanaKey + "T00:00:00"), 6), "yyyy-MM-dd");

    async function fetch() {
      const supabase = createClient();
      const resultado: LineaDesglose[] = [];

      // Asignaciones reales activas
      const { data: realData } = await supabase
        .from("asignacion")
        .select("pct_dedicacion, engagement_id, engagement:engagement_id(nombre)")
        .eq("persona_id", state.personaId)
        .eq("estado", "activa")
        .lte("fecha_inicio", fechaFin)
        .or(`fecha_fin.gte.${fechaInicio},fecha_fin.is.null`);

      for (const a of realData ?? []) {
        const nombre = (a.engagement as { nombre: string } | null)?.nombre ?? "—";
        resultado.push({ engagement_nombre: nombre, pct: Number(a.pct_dedicacion), tipo: "real" });
      }

      // Si hay plan: asignaciones propuestas del plan
      if (planId) {
        const { data: planData } = await supabase
          .from("asignacion_propuesta")
          .select("pct_dedicacion, engagement_id, engagement:engagement_id(nombre)")
          .eq("persona_id", state.personaId)
          .eq("plan_id", planId)
          .eq("estado", "borrador")
          .lte("fecha_inicio", fechaFin)
          .gte("fecha_fin", fechaInicio);

        for (const a of planData ?? []) {
          const nombre = (a.engagement as { nombre: string } | null)?.nombre ?? "—";
          resultado.push({ engagement_nombre: nombre, pct: Number(a.pct_dedicacion), tipo: "plan" });
        }
      }

      setLineas(resultado);
      setLoading(false);
    }
    fetch();
  }, [state.personaId, state.semanaKey, planId]);

  // Posición: calcular dónde poner el popover cerca de la celda
  const rect = state.rect;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const popoverWidth = 260;
  const popoverHeight = 200; // estimado

  // Horizontal: intentar a la derecha de la celda, si no cabe, a la izquierda
  let left = rect.right + 8;
  if (left + popoverWidth > viewportWidth - 8) {
    left = rect.left - popoverWidth - 8;
  }
  // Vertical: alinear con el top de la celda, ajustar si se sale
  let top = rect.top;
  if (top + popoverHeight > viewportHeight - 8) {
    top = viewportHeight - popoverHeight - 8;
  }

  const total = lineas.reduce((s, l) => s + l.pct, 0);

  return (
    <>
      {/* Overlay invisible para cerrar al click fuera */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover */}
      <div
        ref={popoverRef}
        className="fixed z-50 bg-white border border-[#e8e8e8] rounded-xl shadow-xl overflow-hidden"
        style={{ left, top, width: popoverWidth }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#f9f9f9] border-b border-[#e8e8e8]">
          <div>
            <p className="text-xs font-semibold text-[#1a1a1a] truncate max-w-[170px]">
              {state.personaNombre}
            </p>
            <p className="text-[10px] text-[#888]">{state.semanaLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center text-[#888] hover:text-[#333] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Contenido */}
        <div className="px-4 py-3">
          {loading ? (
            <p className="text-xs text-[#888] text-center py-2">Cargando...</p>
          ) : lineas.length === 0 ? (
            <p className="text-xs text-[#888] text-center py-2">Sin asignaciones esta semana.</p>
          ) : (
            <div className="space-y-2">
              {lineas.map((l, i) => {
                const { bg, text } = colorOcupacion(l.pct);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#1a1a1a] truncate">
                        {l.engagement_nombre}
                      </p>
                      {l.tipo === "plan" && (
                        <p className="text-[10px] text-[#4a90e2]">propuesto</p>
                      )}
                    </div>
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: bg, color: text }}
                    >
                      {formatPct(l.pct)}
                    </span>
                  </div>
                );
              })}
              {/* Total */}
              {lineas.length > 1 && (
                <div className="border-t border-[#f0f0f0] pt-2 flex items-center justify-between">
                  <span className="text-xs text-[#888]">Total</span>
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={(() => {
                      const { bg, text } = colorOcupacion(total);
                      return { background: bg, color: text };
                    })()}
                  >
                    {formatPct(total)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────────────────────

export function TablonOcupacion({ semanaInicio, planId }: Props) {
  const [filas, setFilas] = useState<FilaPersona[]>([]);
  const [semanas, setSemanas] = useState<Date[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const result = planId
      ? await fetchOcupacionSemanasPlan(supabase, semanaInicio, planId)
      : await fetchOcupacionSemanas(supabase, semanaInicio);

    if (result.error) {
      setError(result.error);
    } else {
      setFilas(result.filas);
      setSemanas(result.semanas);
    }
    setLoading(false);
  }, [semanaInicio, planId]);

  useEffect(() => { cargar(); }, [cargar]);
  // Cerrar popover al recargar
  useEffect(() => { setPopover(null); }, [semanaInicio, planId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-[#888]">
        Cargando tablero...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-red-500">
        Error: {error}
      </div>
    );
  }

  if (filas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-[#888] gap-1">
        <p className="text-sm font-medium">Sin datos de ocupación.</p>
        <p className="text-xs">
          Asegúrate de haber ejecutado el seed y de tener asignaciones activas.
        </p>
      </div>
    );
  }

  const handleCeldaClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    fila: FilaPersona,
    semana: Date,
    pct: number
  ) => {
    const key = format(semana, "yyyy-MM-dd");
    const lunes = startOfISOWeek(semana);
    const rect = e.currentTarget.getBoundingClientRect();

    // Toggle: cerrar si ya está abierto para la misma celda
    if (popover?.personaId === fila.persona_id && popover?.semanaKey === key) {
      setPopover(null);
      return;
    }

    setPopover({
      personaId: fila.persona_id,
      personaNombre: fila.persona_nombre,
      semanaKey: key,
      semanaLabel: `Sem. del ${format(lunes, "d MMM", { locale: es })}`,
      pct,
      rect,
    });
  };

  return (
    <div className="p-6">
      {/* Leyenda */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <span className="text-xs text-[#888] font-medium">Ocupación:</span>
        {[
          { label: "Sin asignar", bg: "#f0f0f0", text: "#888" },
          { label: "1–50%",   bg: "#dcf5e7", text: "#1e7e45" },
          { label: "51–80%",  bg: "#fff4d4", text: "#8a6200" },
          { label: "81–99%",  bg: "#ffe4c4", text: "#c45000" },
          { label: "100%",    bg: "#ffd4d4", text: "#c02020" },
          { label: ">100%",   bg: "#ffc0c0", text: "#c02020" },
        ].map((item) => (
          <span
            key={item.label}
            className="text-xs px-2 py-0.5 rounded-md font-medium"
            style={{ background: item.bg, color: item.text }}
          >
            {item.label}
          </span>
        ))}
        <span className="text-xs text-[#aaa] ml-1">· Click en una celda para ver el desglose</span>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#e8e8e8] bg-[#f9f9f9]">
                <th className="text-left px-4 py-3 font-semibold text-[#555] w-52 sticky left-0 bg-[#f9f9f9] z-10">
                  Persona
                </th>
                <th className="text-left px-3 py-3 font-semibold text-[#555] w-36">
                  Cargo
                </th>
                {semanas.map((s) => {
                  const lunes = startOfISOWeek(s);
                  return (
                    <th
                      key={format(s, "yyyy-MM-dd")}
                      className="px-2 py-3 font-semibold text-[#555] text-center min-w-[90px]"
                    >
                      <div className="text-[11px] font-bold text-[#333]">
                        {format(lunes, "d MMM", { locale: es })}
                      </div>
                      <div className="text-[10px] text-[#aaa] font-normal">
                        sem {format(lunes, "w")}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, idx) => (
                <tr
                  key={fila.persona_id}
                  className={idx % 2 === 0 ? "border-b border-[#f5f5f5]" : "border-b border-[#f5f5f5] bg-[#fafafa]"}
                >
                  <td className="px-4 py-2 font-medium sticky left-0 bg-inherit z-10">
                    <span className="truncate block max-w-[180px]">{fila.persona_nombre}</span>
                  </td>
                  <td className="px-3 py-2 text-[#888] text-xs">{fila.cargo_actual}</td>
                  {semanas.map((s) => {
                    const key = format(s, "yyyy-MM-dd");
                    const datos = fila.semanas[key] ?? { actual: 0, proyectado: 0 };
                    const pct = planId ? datos.proyectado : datos.actual;
                    const tieneAlerta = planId != null && datos.proyectado > 100;
                    const isOpen = popover?.personaId === fila.persona_id && popover?.semanaKey === key;

                    return (
                      <td key={key} className="px-2 py-2">
                        <div className={`relative ${isOpen ? "z-30" : ""}`}>
                          <CeldaOcupacion
                            pct={pct}
                            tieneAlerta={tieneAlerta}
                            onClick={(e) => handleCeldaClick(e, fila, s, pct)}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nota de modo */}
      <p className="mt-3 text-xs text-[#aaa]">
        {planId
          ? "Vista de plan: asignaciones reales + asignaciones propuestas en este plan."
          : "Vista real: solo asignaciones aprobadas."}
      </p>

      {/* Popover de desglose */}
      {popover && (
        <DesglosePopover
          state={popover}
          planId={planId}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
