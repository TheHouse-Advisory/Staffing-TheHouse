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

// Gráfico de evolución de notas (escala 1–7), puntos en orden cronológico
export function EvaluacionesChart({ datos }: { datos: PuntoEvaluacion[] }) {
  const serie = datos.map((d) => ({ ...d, nota: Number(d.nota) }));
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
            domain={[1, 7]}
            ticks={[1, 2, 3, 4, 5, 6, 7]}
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
