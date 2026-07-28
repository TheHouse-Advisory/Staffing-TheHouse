"use client";

import { useRef } from "react";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";

interface NavegadorFechasProps {
  label: string;
  /** Navegación gruesa: el salto exacto lo decide cada vista según su período activo */
  onPrev: () => void;
  onNext: () => void;
  /** Navegación fina: siempre exactamente 1 semana (7 días) */
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onHoy?: () => void;
  /** Si se pasa, el label se vuelve clickeable y abre un date picker nativo */
  onSeleccionarFecha?: (fecha: Date) => void;
  labelWidthClassName?: string;
  /** Botonera compacta sin bordes, para headers de cuadrante angostos */
  compact?: boolean;
}

export function NavegadorFechas({
  label,
  onPrev,
  onNext,
  onPrevWeek,
  onNextWeek,
  onHoy,
  onSeleccionarFecha,
  labelWidthClassName,
  compact = false,
}: NavegadorFechasProps) {
  const fechaInputRef = useRef<HTMLInputElement>(null);

  function abrirPicker() {
    if (!onSeleccionarFecha) return;
    const el = fechaInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.click();
  }

  function handleFechaElegida(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.value) return;
    onSeleccionarFecha?.(new Date(e.target.value + "T00:00:00"));
  }
  const btn = compact
    ? "p-1 rounded hover:bg-gray-100 text-gray-400"
    : "w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors";
  const iconSize = compact ? "w-3.5 h-3.5" : "w-3.5 h-3.5";
  const labelClass = compact
    ? "text-[11px] text-gray-400 whitespace-nowrap"
    : `font-semibold text-[#1a1a1a] text-center text-xs ${labelWidthClassName ?? "min-w-[220px]"}`;

  return (
    <div className="flex items-center gap-1">
      {/* << salto grande hacia atrás */}
      <button onClick={onPrev} title="Retroceder" className={btn}>
        <ChevronsLeft className={iconSize} />
      </button>
      {/* < 1 semana atrás */}
      <button onClick={onPrevWeek} title="Retroceder 1 semana" className={btn}>
        <ChevronLeft className={iconSize} />
      </button>
      {onSeleccionarFecha ? (
        <span className="relative inline-flex">
          <button
            type="button"
            onClick={abrirPicker}
            title="Elegir fecha"
            className={`${labelClass} hover:text-[#4a90e2] cursor-pointer transition-colors`}
          >
            {label}
          </button>
          <input
            ref={fechaInputRef}
            type="date"
            onChange={handleFechaElegida}
            className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
            tabIndex={-1}
          />
        </span>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      {/* > 1 semana adelante */}
      <button onClick={onNextWeek} title="Avanzar 1 semana" className={btn}>
        <ChevronRight className={iconSize} />
      </button>
      {/* >> salto grande hacia adelante */}
      <button onClick={onNext} title="Avanzar" className={btn}>
        <ChevronsRight className={iconSize} />
      </button>
      {onHoy && (
        <button
          onClick={onHoy}
          className="ml-1 text-xs px-2.5 py-1 rounded-md border border-[#e0e0e0] hover:bg-[#f5f5f5] transition-colors text-[#555]"
        >
          Hoy
        </button>
      )}
    </div>
  );
}
