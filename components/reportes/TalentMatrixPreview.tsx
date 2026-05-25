"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";

// ── Colores de cargo ──────────────────────────────────────────────
const COLORES_CARGO: Record<string, string> = {
  "Socio":                   "#1a1a2e",
  "Director de Proyectos":   "#4a90e2", "Director":            "#4a90e2",
  "Gerente de Proyectos":    "#7c5cbf", "Gerente":             "#7c5cbf",
  "Asociado":                "#e2884a",
  "Consultor Senior":        "#4ab89a",
  "Consultor de Proyectos":  "#e24a6a",
  "Consultor Analista":      "#a0b84a",
  "Consultor Trainee":       "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";

// Colores del 9-box (fila 0 = alto potencial)
const BOX_COLORS = [
  "#8c9e99", "#4a7075", "#1e5f5a",
  "#b8c0bb", "#607d8b", "#38a89d",
  "#e05555", "#8fa0a8", "#e07b2a",
];

// ── Grupos de filtro ──────────────────────────────────────────────
const GRUPOS = [
  { id: "todos", sigla: "Todos", label: "Toda la empresa",                         cargos: null as string[] | null },
  { id: "dg",   sigla: "D/G",   label: "Directores y Gerentes",                   cargos: ["Socio","Director de Proyectos","Director","Gerente de Proyectos","Gerente","Director / Gerente de Proyectos"] },
  { id: "asr",  sigla: "A/Sr",  label: "Consultores Senior y Asociados",           cargos: ["Asociado","Consultor Senior","Asociado / Consultor Senior"] },
  { id: "c",    sigla: "C",     label: "Consultores, Analistas y Trainees",        cargos: ["Consultor de Proyectos","Consultor Proyecto","Consultor","Consultor Analista","Analista Senior","Consultor Trainee","Analista","Practicante"] },
] as const;

// ── Utilidades de coordenadas ─────────────────────────────────────
/**
 * Mapea score 1-5 a porcentaje 5-95% (padding para evitar clipping en bordes).
 * X = eje Desempeño (izquierda=bajo, derecha=alto)
 * Y = eje Potencial  (abajo=bajo, arriba=alto) → CSS usa `bottom`
 */
function toCoords(desempeno: number, potencial: number) {
  const x = 5 + ((desempeno - 1) / 4) * 90;
  const y = 5 + ((potencial  - 1) / 4) * 90;
  return { x, y };
}

/** Jitter determinista basado en el ID para evitar solapamiento exacto */
function jitter(id: string): { dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return {
    dx: (((h & 0xff)       / 255) - 0.5) * 5,  // ±2.5 px
    dy: ((((h >> 8) & 0xff) / 255) - 0.5) * 5,
  };
}

function iniciales(n: string, a: string) {
  return `${n[0] ?? ""}${a[0] ?? ""}`.toUpperCase();
}

interface PersonaData {
  id: string; nombre: string; apellido: string;
  cargo_actual: string | null;
  talento_potencial: number | null;
  talento_desempeno: number | null;
}

export function TalentMatrixPreview() {
  const [personas,    setPersonas]    = useState<PersonaData[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [grupoActivo, setGrupoActivo] = useState("todos");

  useEffect(() => {
    createAnyClient()
      .from("persona")
      .select("id, nombre, apellido, cargo_actual, talento_potencial, talento_desempeno")
      .eq("activo", true)
      .not("talento_potencial", "is", null)
      .not("talento_desempeno",  "is", null)
      .then(({ data }) => { setPersonas((data ?? []) as PersonaData[]); setLoading(false); });
  }, []);

  const grupo = GRUPOS.find(g => g.id === grupoActivo)!;
  const filtradas = grupo.cargos === null
    ? personas
    : personas.filter(p => (grupo.cargos as string[]).includes(p.cargo_actual ?? ""));

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col gap-2 px-2.5 pt-2 pb-1.5">

      {/* ── Barra de filtros ─────────────────────────────── */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 flex-shrink-0">
        {GRUPOS.map(g => (
          <button
            key={g.id}
            onClick={() => setGrupoActivo(g.id)}
            title={g.label}
            className={`flex-1 flex flex-col items-center py-1 rounded-md transition-all ${
              grupoActivo === g.id
                ? "bg-[#1a1a2e] text-white shadow-sm"
                : "text-slate-400 hover:bg-white hover:text-slate-700"
            }`}
          >
            <span className="text-[10px] font-black leading-none">{g.sigla}</span>
            <span className={`text-[7px] font-medium leading-tight mt-0.5 ${grupoActivo === g.id ? "text-white/60" : "text-slate-400"}`}>
              {g.label.split(" ").slice(0, 2).join(" ")}
            </span>
          </button>
        ))}
      </div>

      {/* ── Scatter Plot ─────────────────────────────────── */}
      <div className="flex gap-1.5 flex-1 min-h-0">

        {/* Eje Y — Potencial */}
        <div className="flex items-center justify-center flex-shrink-0" style={{ width: 10 }}>
          <span className="text-[7px] font-bold text-slate-400 uppercase"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", letterSpacing: 1 }}>
            ↑ Potencial
          </span>
        </div>

        {/* Marco principal: fondo 9-box + badges absolutos */}
        <div className="flex-1 relative rounded-md overflow-hidden">

          {/* Capa 1: fondo 9-box (grid CSS) */}
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px bg-slate-300">
            {BOX_COLORS.map((color, i) => (
              <div key={i} style={{ background: color, opacity: 0.88 }} />
            ))}
          </div>

          {/* Capa 2: badges posicionados por coordenadas reales */}
          <div className="absolute inset-0">
            {filtradas.map(p => {
              const { x, y } = toCoords(p.talento_desempeno!, p.talento_potencial!);
              const { dx, dy } = jitter(p.id);
              return (
                <div
                  key={p.id}
                  title={`${p.nombre} ${p.apellido} · D:${p.talento_desempeno} P:${p.talento_potencial}`}
                  className="absolute w-[20px] h-[20px] rounded-full flex items-center justify-center shadow-md ring-1 ring-white/40 cursor-default z-10"
                  style={{
                    left:       `${x}%`,
                    bottom:     `${y}%`,
                    transform:  `translateX(calc(-50% + ${dx}px)) translateY(calc(50% + ${dy}px))`,
                    background: COLORES_CARGO[p.cargo_actual ?? ""] ?? COLOR_DEFAULT,
                  }}
                >
                  <span className="text-[7px] font-bold text-white leading-none select-none">
                    {iniciales(p.nombre, p.apellido)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Eje X + Contador ─────────────────────────────── */}
      <div className="flex items-center pl-[14px] flex-shrink-0">
        <span className="text-[7px] font-bold text-slate-400 uppercase tracking-wide flex-1">
          Desempeño →
        </span>
        <span className="text-[7px] text-slate-400">
          {filtradas.length} {filtradas.length === 1 ? "persona" : "personas"}
        </span>
      </div>
    </div>
  );
}
