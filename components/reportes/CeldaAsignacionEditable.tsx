"use client";

import { useEffect, useRef, useState } from "react";

export interface AsigSlot {
  id: string;
  engagementId: string;
  personaId: string;
  iniciales: string;
  cargo: string;
  requerimientoId: string | null;
  pctDedicacion: number;
  estadoStaffing: "CONFIRMADO" | "PLAN";
  fechaInicio: string;
  fechaFin: string | null;
}

export interface LineaEditable {
  engagementId: string;
  cargo: string;
  requerimientoId: string | null;
  pctDedicacion: number;
  confirmados: AsigSlot[];
  plan: AsigSlot[];
  vacio: boolean;
}

export interface PersonaOpcion {
  id: string;
  nombre: string;
  apellido: string;
  iniciales: string;
}

export interface Semana {
  inicio: string;
  fin: string;
}

export interface ActualizarLineaParams {
  engagementId: string;
  cargo: string;
  requerimientoId: string | null;
  pctDedicacion: number;
  semana: Semana;
  actuales: {
    id: string;
    personaId: string;
    estadoStaffing: "CONFIRMADO" | "PLAN";
    fechaInicio: string;
    fechaFin: string | null;
  }[];
  deseados: { personaId: string; estado: "CONFIRMADO" | "PLAN" }[];
}

interface Props {
  semana: Semana;
  lineas: LineaEditable[];
  personasDisponibles: PersonaOpcion[];
  onActualizar: (params: ActualizarLineaParams) => Promise<void>;
}

// ── Texto <-> estructura (misma simbología: "PLAN/PLAN · CONF + CONF") ──

function textoDeLinea(l: LineaEditable): string {
  const plan = l.plan.map((s) => s.iniciales).join("/");
  const conf = l.confirmados.map((s) => s.iniciales).join(" + ");
  if (plan && conf) return `${plan} · ${conf}`;
  return plan || conf;
}

function parseTexto(texto: string): { plan: string[]; confirmados: string[] } {
  const idx = texto.indexOf("·");
  let planTexto = "";
  let confTexto = "";
  if (idx >= 0) {
    planTexto = texto.slice(0, idx);
    confTexto = texto.slice(idx + 1);
  } else if (texto.includes("+")) {
    confTexto = texto;
  } else {
    planTexto = texto;
  }
  const tokens = (s: string, sep: RegExp) =>
    s.split(sep).map((t) => t.trim().toUpperCase()).filter(Boolean);
  // El salto de línea (Shift+Enter) también separa nombres dentro del mismo grupo
  return { plan: tokens(planTexto, /[/\n]/), confirmados: tokens(confTexto, /[+\n]/) };
}

// ── Una línea (cargo) dentro de la celda ────────────────────────────

function LineaCelda({
  linea, semana, personasDisponibles, onActualizar,
}: {
  linea: LineaEditable;
  semana: Semana;
  personasDisponibles: PersonaOpcion[];
  onActualizar: (params: ActualizarLineaParams) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [noReconocidos, setNoReconocidos] = useState<string[] | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-crece el textarea al alto de su contenido (sin scrollbar ni resize manual)
  useEffect(() => {
    const el = textareaRef.current;
    if (editando && el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editando, texto]);

  function iniciarEdicion() {
    setTexto(textoDeLinea(linea));
    setNoReconocidos(null);
    setEditando(true);
  }

  async function guardar() {
    const { plan: planTokens, confirmados: confTokens } = parseTexto(texto);
    const noResueltos: string[] = [];
    const resolver = (token: string) => {
      const p = personasDisponibles.find((p) => p.iniciales.toUpperCase() === token);
      if (!p) noResueltos.push(token);
      return p;
    };

    const confirmados = confTokens.map(resolver).filter((p): p is PersonaOpcion => !!p);
    const plan = planTokens.map(resolver).filter((p): p is PersonaOpcion => !!p);

    if (noResueltos.length > 0) {
      setNoReconocidos(noResueltos);
      return; // no guarda hasta corregir iniciales desconocidas
    }

    setGuardando(true);
    await onActualizar({
      engagementId: linea.engagementId,
      cargo: linea.cargo,
      requerimientoId: linea.requerimientoId,
      pctDedicacion: linea.pctDedicacion,
      semana,
      actuales: [...linea.confirmados, ...linea.plan].map((s) => ({
        id: s.id,
        personaId: s.personaId,
        estadoStaffing: s.estadoStaffing,
        fechaInicio: s.fechaInicio,
        fechaFin: s.fechaFin,
      })),
      deseados: [
        ...confirmados.map((p) => ({ personaId: p.id, estado: "CONFIRMADO" as const })),
        ...plan.map((p) => ({ personaId: p.id, estado: "PLAN" as const })),
      ],
    });
    setGuardando(false);
    setEditando(false);
  }

  if (!editando) {
    return (
      <div
        onClick={iniciarEdicion}
        title="Clic para editar"
        className="text-[11px] leading-4 whitespace-pre-wrap cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-[#fff3d6]"
      >
        {linea.plan.length > 0 && (
          <span className="text-[#888]">{linea.plan.map((s) => s.iniciales).join("/")}</span>
        )}
        {linea.plan.length > 0 && linea.confirmados.length > 0 && <span className="text-[#ccc] mx-0.5">·</span>}
        {linea.confirmados.length > 0 && (
          <span className="font-semibold text-[#1a1a1a]">{linea.confirmados.map((s) => s.iniciales).join(" + ")}</span>
        )}
        {linea.vacio && <span className="font-bold text-red-500">?</span>}
      </div>
    );
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        value={texto}
        disabled={guardando}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur(); // dispara onBlur -> guardar()
          } else if (e.key === "Escape") {
            setEditando(false);
          }
          // Shift+Enter: se deja el comportamiento nativo (inserta \n)
        }}
        placeholder="GB/AJ · FT + ER"
        className="block w-full h-full min-h-[1.1rem] text-[11px] px-1 py-0.5 bg-white rounded resize-none overflow-hidden whitespace-pre-wrap outline-none focus:ring-1 focus:ring-[#4a90e2] disabled:opacity-50"
      />
      {noReconocidos && (
        <p className="text-[9px] text-red-500 mt-0.5 leading-tight">
          No reconocido: {noReconocidos.join(", ")}
        </p>
      )}
    </div>
  );
}

// ── Celda (puede contener más de un cargo requerido esa semana) ──────

export function CeldaAsignacionEditable({ semana, lineas, personasDisponibles, onActualizar }: Props) {
  if (lineas.length === 0) return <td className="border border-[#e8e8e8] px-2 py-1 bg-white" />;
  return (
    <td className="border border-[#e8e8e8] px-2 py-1 bg-[#fef9f0] align-top min-w-[90px]">
      {lineas.map((l, i) => (
        <LineaCelda key={i} linea={l} semana={semana} personasDisponibles={personasDisponibles} onActualizar={onActualizar} />
      ))}
    </td>
  );
}
