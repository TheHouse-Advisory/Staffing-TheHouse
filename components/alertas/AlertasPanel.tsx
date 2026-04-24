"use client";

import { useEffect, useState } from "react";
import { format, isSameDay, parseISO, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { PartyPopper, Clock, CheckCircle2, Circle, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";

// ── Tipos ────────────────────────────────────────────────────────

interface PersonaAniversario {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
  fecha_ingreso: string;
  años: number;
  fechaAniversario: Date;
}

interface AlertaChecked {
  alertaId: string;         // e.g. "aniversario-{persona_id}-{año}"
  tipo: string;
  descripcion: string;      // texto legible para el historial
  fechaCheck: string;       // ISO string del momento en que se marcó
}

const LS_KEY = "staffinghub_alertas_checked";

function leerChecks(): AlertaChecked[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}

function guardarChecks(checks: AlertaChecked[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(checks));
}

// ── Helpers de fecha ─────────────────────────────────────────────

function proximoAniversario(fechaIngreso: string, desde: Date): Date {
  const ingreso = parseISO(fechaIngreso);
  const aniv = new Date(desde.getFullYear(), ingreso.getMonth(), ingreso.getDate());
  if (aniv < startOfDay(desde)) aniv.setFullYear(aniv.getFullYear() + 1);
  return aniv;
}

function añosEn(fechaIngreso: string, enFecha: Date): number {
  return enFecha.getFullYear() - parseISO(fechaIngreso).getFullYear();
}

function alertaId(tipo: string, personaId: string, año: number) {
  return `${tipo}-${personaId}-${año}`;
}

// ── Componente tarjeta de alerta ─────────────────────────────────

function TarjetaAniversario({
  p,
  esHoy,
  diffDias,
  checked,
  onCheck,
}: {
  p: PersonaAniversario;
  esHoy: boolean;
  diffDias?: number;
  checked: boolean;
  onCheck: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
        checked
          ? "border-gray-100 bg-gray-50 opacity-60"
          : esHoy
          ? "border-[#4a90e2]/30 bg-[#eaf4ff]"
          : "border-gray-100 bg-white hover:bg-gray-50"
      }`}
    >
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
        style={{ backgroundColor: esHoy ? "#4a90e2" : "#94a3b8" }}
      >
        {p.nombre[0]}{p.apellido[0]}
      </div>

      {/* Texto */}
      <div className="flex-1">
        {esHoy ? (
          <p className={`font-semibold text-[#1a1a2e] ${checked ? "line-through text-gray-400" : ""}`}>
            🎉 Felicita a{" "}
            <span className={checked ? "" : "text-[#4a90e2]"}>
              {p.nombre} {p.apellido}
            </span>{" "}
            por cumplir{" "}
            <span className="font-bold">{p.años} {p.años === 1 ? "año" : "años"}</span>{" "}
            en la empresa
          </p>
        ) : (
          <p className={`font-semibold text-[#1a1a2e] ${checked ? "line-through text-gray-400" : ""}`}>
            {p.nombre} {p.apellido}
            <span className="ml-2 text-xs font-normal text-gray-400">
              cumple{" "}
              <span className="font-semibold text-[#1a1a2e]">
                {p.años} {p.años === 1 ? "año" : "años"}
              </span>{" "}
              en la empresa
            </span>
          </p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">
          {esHoy ? (
            <>
              Ingresó el{" "}
              {format(parseISO(p.fecha_ingreso), "d 'de' MMMM 'de' yyyy", { locale: es })}
            </>
          ) : (
            <>
              El{" "}
              <span className="font-medium text-gray-600">
                {format(p.fechaAniversario, "d 'de' MMMM", { locale: es })}
              </span>
              {diffDias !== undefined && (
                <span className="ml-2 text-[#4a90e2] font-medium">
                  en {diffDias} {diffDias === 1 ? "día" : "días"}
                </span>
              )}
            </>
          )}
          {p.cargo_actual && (
            <span className="ml-2 text-gray-300">· {p.cargo_actual}</span>
          )}
        </p>
      </div>

      {/* Botón check */}
      <button
        onClick={onCheck}
        title={checked ? "Desmarcar" : "Marcar como gestionado"}
        className="flex-shrink-0 transition-transform hover:scale-110"
      >
        {checked
          ? <CheckCircle2 className="w-6 h-6 text-[#27ae60]" />
          : <Circle className="w-6 h-6 text-gray-300 hover:text-[#27ae60]" />
        }
      </button>
    </div>
  );
}

// ── Panel principal ──────────────────────────────────────────────

export function AlertasPanel() {
  const [hoy, setHoy] = useState<PersonaAniversario[]>([]);
  const [proximos, setProximos] = useState<PersonaAniversario[]>([]);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<AlertaChecked[]>([]);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  // Cargar checks desde localStorage
  useEffect(() => { setChecks(leerChecks()); }, []);

  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const { data } = await sb
        .from("persona")
        .select("id, nombre, apellido, cargo_actual, fecha_ingreso")
        .eq("activo", true)
        .not("fecha_ingreso", "is", null);

      const personas = (data ?? []) as {
        id: string; nombre: string; apellido: string;
        cargo_actual: string | null; fecha_ingreso: string;
      }[];

      const ahora = new Date();
      const hoyArr: PersonaAniversario[] = [];
      const proximosArr: PersonaAniversario[] = [];

      for (const p of personas) {
        const fechaAniversario = proximoAniversario(p.fecha_ingreso, ahora);
        const años = añosEn(p.fecha_ingreso, fechaAniversario);
        if (años === 0) continue;

        const entrada: PersonaAniversario = { ...p, años, fechaAniversario };

        if (isSameDay(fechaAniversario, ahora)) {
          hoyArr.push(entrada);
        } else {
          const diffDias = Math.ceil(
            (fechaAniversario.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24)
          );
          if (diffDias <= 30) proximosArr.push(entrada);
        }
      }

      proximosArr.sort((a, b) => a.fechaAniversario.getTime() - b.fechaAniversario.getTime());
      setHoy(hoyArr);
      setProximos(proximosArr);
      setLoading(false);
    }
    load();
  }, []);

  function toggleCheck(p: PersonaAniversario, esHoy: boolean) {
    const id = alertaId("aniversario", p.id, p.años);
    const yaChecked = checks.some((c) => c.alertaId === id);

    let nuevos: AlertaChecked[];
    if (yaChecked) {
      nuevos = checks.filter((c) => c.alertaId !== id);
    } else {
      const desc = `${esHoy ? "🎉 " : ""}${p.nombre} ${p.apellido} — ${p.años} ${p.años === 1 ? "año" : "años"} en la empresa (${format(p.fechaAniversario, "d MMM yyyy", { locale: es })})`;
      nuevos = [
        ...checks,
        {
          alertaId: id,
          tipo: "aniversario",
          descripcion: desc,
          fechaCheck: new Date().toISOString(),
        },
      ];
    }
    setChecks(nuevos);
    guardarChecks(nuevos);
  }

  function eliminarDelHistorial(alertaId: string) {
    const nuevos = checks.filter((c) => c.alertaId !== alertaId);
    setChecks(nuevos);
    guardarChecks(nuevos);
  }

  function isChecked(p: PersonaAniversario) {
    return checks.some((c) => c.alertaId === alertaId("aniversario", p.id, p.años));
  }

  if (loading) return <p className="text-sm text-gray-400">Cargando alertas...</p>;

  const sinAlertas = hoy.length === 0 && proximos.length === 0;
  const ahora = new Date();

  return (
    <div className="space-y-6">

      {/* ── Hoy ───────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <PartyPopper className="w-4 h-4 text-[#4a90e2]" />
          <h2 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide">Hoy</h2>
        </div>

        {hoy.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Sin aniversarios hoy.</p>
        ) : (
          <div className="space-y-2">
            {hoy.map((p) => (
              <TarjetaAniversario
                key={p.id}
                p={p}
                esHoy
                checked={isChecked(p)}
                onCheck={() => toggleCheck(p, true)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Próximos 30 días ──────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide">Próximos 30 días</h2>
        </div>

        {proximos.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Sin aniversarios en los próximos 30 días.</p>
        ) : (
          <div className="space-y-2">
            {proximos.map((p) => {
              const diffDias = Math.ceil(
                (p.fechaAniversario.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24)
              );
              return (
                <TarjetaAniversario
                  key={p.id}
                  p={p}
                  esHoy={false}
                  diffDias={diffDias}
                  checked={isChecked(p)}
                  onCheck={() => toggleCheck(p, false)}
                />
              );
            })}
          </div>
        )}
      </section>

      {sinAlertas && (
        <p className="text-sm text-gray-400 italic text-center py-8">
          Sin alertas activas por ahora.
        </p>
      )}

      {/* ── Historial de alertas gestionadas ─────── */}
      {checks.length > 0 && (
        <section className="border-t border-gray-100 pt-4">
          <button
            onClick={() => setHistorialAbierto((v) => !v)}
            className="flex items-center gap-2 w-full text-left group"
          >
            <CheckCircle2 className="w-4 h-4 text-[#27ae60]" />
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide flex-1">
              Historial gestionadas
              <span className="ml-2 text-xs font-semibold text-white bg-[#27ae60] rounded-full px-2 py-0.5 normal-case tracking-normal">
                {checks.length}
              </span>
            </h2>
            {historialAbierto
              ? <ChevronUp className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />
            }
          </button>

          {historialAbierto && (
            <div className="mt-3 space-y-2">
              {[...checks]
                .sort((a, b) => b.fechaCheck.localeCompare(a.fechaCheck))
                .map((c) => (
                  <div
                    key={c.alertaId}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 border border-gray-100"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[#27ae60] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-600 truncate">{c.descripcion}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Gestionado el{" "}
                        {format(parseISO(c.fechaCheck), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}
                      </p>
                    </div>
                    <button
                      onClick={() => eliminarDelHistorial(c.alertaId)}
                      title="Eliminar del historial"
                      className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
