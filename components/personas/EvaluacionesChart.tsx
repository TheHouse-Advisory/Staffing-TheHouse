"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

export interface PuntoEvaluacion {
  fecha: string;            // yyyy-MM-dd
  nota: number;
  cargo?: string | null;
  comentario: string | null;
}

// Serie única: un solo color (azul del perfil), sin leyenda (el título de la fila la nombra)
const COLOR_SERIE = "#3b82f6";
const COLOR_EJE = "#9ca3af";
const COLOR_GRID = "#f0f0f0";

const fmtMes = (fecha: string) => format(parseISO(fecha), "MMM yyyy", { locale: es });

function TooltipEvaluacion({ active, payload }: { active?: boolean; payload?: { payload: PuntoEvaluacion }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-[#e8e8e8] rounded-lg shadow-md px-3 py-2 max-w-[220px]">
      <p className="text-[11px] text-[#888] capitalize">{format(parseISO(p.fecha), "d MMM yyyy", { locale: es })}</p>
      <p className="text-sm font-bold text-[#1a1a1a] tabular-nums">Nota {Number(p.nota).toFixed(1)}</p>
      {p.cargo && <p className="text-[11px] text-[#555]">{p.cargo}</p>}
      {p.comentario && <p className="text-[11px] text-[#555] italic mt-0.5 break-words">{p.comentario}</p>}
    </div>
  );
}

// Gráfico de evolución de notas, puntos en orden cronológico. Escala según el tipo (EDD 1–5, EPP 1–3)
export function EvaluacionesChart({ datos, min = 1, max = 5 }: { datos: PuntoEvaluacion[]; min?: number; max?: number }) {
  const serie = datos.map((d) => ({ ...d, nota: Number(d.nota) }));
  const ticks = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={COLOR_GRID} vertical={false} />
          <XAxis
            dataKey="fecha"
            tickFormatter={fmtMes}
            tick={{ fontSize: 10, fill: COLOR_EJE }}
            axisLine={{ stroke: COLOR_GRID }}
            tickLine={false}
            padding={{ left: 16, right: 16 }}
          />
          <YAxis
            domain={[min, max]}
            ticks={ticks}
            tick={{ fontSize: 10, fill: COLOR_EJE }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<TooltipEvaluacion />} cursor={{ stroke: COLOR_EJE, strokeDasharray: "3 3" }} />
          <Line
            type="monotone"
            dataKey="nota"
            stroke={COLOR_SERIE}
            strokeWidth={2}
            dot={{ r: 4, fill: COLOR_SERIE, stroke: "#fff", strokeWidth: 2 }}
            activeDot={{ r: 6, fill: COLOR_SERIE, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
