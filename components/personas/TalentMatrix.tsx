"use client";

import { useRef } from "react";
import { MapPin } from "lucide-react";

// ─── Definición de los 9 cuadrantes (fila 0 = alto potencial) ───
const BOXES = [
  // fila 0 – Alto potencial
  { title: "Diamante en bruto",         sub: "Alto potencial, bajo desempeño",           bg: "#8c9e99", text: "#fff" },
  { title: "Talento Emergente",          sub: "Alto potencial, desempeño esperado",        bg: "#4a7075", text: "#fff" },
  { title: "Futuro Líder",               sub: "Alto potencial, excelente desempeño",       bg: "#1e5f5a", text: "#fff" },
  // fila 1 – Medio potencial
  { title: "Talento Inconsistente",      sub: "Medio potencial, bajo desempeño",           bg: "#b8c0bb", text: "#333" },
  { title: "Futuro Prometedor",          sub: "Medio potencial, desempeño esperado",       bg: "#607d8b", text: "#fff" },
  { title: "Talento Emergente",          sub: "Medio potencial, excelente desempeño",      bg: "#38a89d", text: "#fff" },
  // fila 2 – Bajo potencial
  { title: "Talento en Riesgo",          sub: "Bajo potencial, bajo desempeño",            bg: "#e05555", text: "#fff" },
  { title: "Talento Estancado",          sub: "Bajo potencial, desempeño esperado",        bg: "#8fa0a8", text: "#fff" },
  { title: "Profesional Experimentado", sub: "Bajo potencial, excelente desempeño",       bg: "#e07b2a", text: "#fff" },
] as const;

const COL_LABELS = ["1-2", "3", "4-5"];
const ROW_LABELS = ["Alto (5)", "Medio (4)", "Bajo (2-3)"];

export function getTalentBoxName(potencial: number | null, desempeno: number | null): string | null {
  if (potencial == null || desempeno == null) return null;
  // La cuadrícula divide el rango [1,5] en 3 tercios iguales → cortes en 7/3 y 11/3
  const b1 = 7 / 3;  // ≈ 2.33
  const b2 = 11 / 3; // ≈ 3.67
  const row = potencial > b2 ? 0 : potencial > b1 ? 1 : 2;
  const col = desempeno <= b1 ? 0 : desempeno <= b2 ? 1 : 2;
  return BOXES[row * 3 + col].title;
}

interface Props {
  potencial:  number | null;
  desempeno:  number | null;
  isEditable: boolean;
  /** Solo se llama si isEditable=true */
  onUpdate?:  (potencial: number, desempeno: number) => void;
  /** "full" muestra etiquetas y ejes; "compact" solo la cuadrícula + marcador */
  size?: "full" | "compact";
}

/** Convierte coordenadas (1-5) a porcentaje de posición en la cuadrícula */
function toPercent(desempeno: number, potencial: number) {
  return {
    x: ((desempeno - 1) / 4) * 100,
    y: ((5 - potencial) / 4) * 100,
  };
}

export function TalentMatrix({ potencial, desempeno, isEditable, onUpdate, size = "full" }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!isEditable || !onUpdate || !gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const rawD = 1 + ((e.clientX - rect.left) / rect.width) * 4;
    const rawP = 5 - ((e.clientY - rect.top)  / rect.height) * 4;
    const d = Math.round(Math.min(5, Math.max(1, rawD)) * 10) / 10;
    const p = Math.round(Math.min(5, Math.max(1, rawP)) * 10) / 10;
    onUpdate(p, d);
  }

  const hasValue = potencial != null && desempeno != null;
  const marker   = hasValue ? toPercent(desempeno!, potencial!) : null;

  if (size === "compact") {
    return (
      <div className="flex flex-col gap-1 items-center">
        <div
          ref={gridRef}
          onClick={handleClick}
          className={`relative grid grid-cols-3 rounded overflow-hidden border border-[#e8e8e8] ${isEditable ? "cursor-crosshair" : ""}`}
          style={{ width: 96, height: 72 }}
        >
          {BOXES.map((b, i) => (
            <div key={i} style={{ background: b.bg, opacity: 0.85 }} />
          ))}
          {marker && (
            <div
              className="absolute w-3 h-3 rounded-full bg-white border-2 border-[#1a1a1a] shadow pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
            />
          )}
          {!hasValue && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[9px] text-white/70 font-medium">Sin asignar</span>
            </div>
          )}
        </div>
        {hasValue && (
          <span className="text-[10px] text-[#888]">P:{potencial} · D:{desempeno}</span>
        )}
      </div>
    );
  }

  // ── Vista full ──
  return (
    <div className="select-none">
      {/* Header eje Y — encima del grid, alineado con él */}
      <p className="text-[10px] font-bold text-[#555] uppercase tracking-wide text-center mb-1" style={{ marginLeft: 80 }}>
        Potencial
      </p>

      {/* Fila principal: labels de fila + grid */}
      <div className="flex gap-2">
        {/* Labels de fila — self-stretch = misma altura que el grid, sin header extra */}
        <div className="self-stretch flex flex-col pr-1" style={{ width: 72 }}>
          {ROW_LABELS.map((l) => (
            <div key={l} className="flex-1 flex items-center justify-end">
              <span className="text-[10px] text-[#888] font-medium text-right leading-tight">{l}</span>
            </div>
          ))}
        </div>

        {/* Cuadrícula + eje X */}
        <div className="flex-1 flex flex-col gap-0">
          <div
            ref={gridRef}
            onClick={handleClick}
            className={`relative grid grid-cols-3 rounded-lg overflow-hidden border border-[#e8e8e8] ${isEditable ? "cursor-crosshair" : ""}`}
            style={{ aspectRatio: "3/2" }}
          >
            {BOXES.map((b, i) => (
              <div
                key={i}
                className="flex flex-col justify-start p-2 border-[0.5px] border-white/20"
                style={{ background: b.bg, color: b.text }}
              >
                <p className="text-[11px] font-bold leading-tight">{b.title}</p>
                <p className="text-[9px] opacity-80 mt-0.5 leading-tight">{b.sub}</p>
              </div>
            ))}

            {/* Marcador */}
            {marker && (
              <div
                className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
                style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
              >
                <MapPin className="w-5 h-5 drop-shadow-md" style={{ color: "#fff", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))" }} />
              </div>
            )}

            {/* Hint editable */}
            {isEditable && !hasValue && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-xs text-white/60 font-medium bg-black/20 px-3 py-1 rounded-full">Clic para posicionar</span>
              </div>
            )}
          </div>

          {/* Etiquetas eje X */}
          <div className="grid grid-cols-3 mt-1">
            {COL_LABELS.map((l) => (
              <div key={l} className="text-[10px] text-[#888] font-medium text-center">{l}</div>
            ))}
          </div>
          <p className="text-[10px] font-bold text-[#555] uppercase tracking-wide text-center mt-0.5">Desempeño</p>
        </div>
      </div>

      {hasValue && (
        <p className="text-xs text-[#888] mt-2 text-center">
          Potencial: <strong>{potencial}</strong> · Desempeño: <strong>{desempeno}</strong>
          {isEditable && <span className="ml-2 text-[#aaa]">· Clic en la matriz para reposicionar</span>}
        </p>
      )}
    </div>
  );
}
