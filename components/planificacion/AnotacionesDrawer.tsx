"use client";

import { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, Trash2, Loader2 } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { createAnyClient } from "@/lib/supabase/client";
import { getCargoColor } from "@/lib/constants";

interface Anotacion {
  id: string;
  texto: string;
  creado_en: string;
  user_id: string;
  autor_nombre: string | null;
  autor_cargo: string | null;
  autor_iniciales: string | null;
}

interface AnotacionesDrawerProps {
  open: boolean;
  onClose: () => void;
  escenarioId: string;
  escenarioNombre: string;
  currentUserId: string | null;
  currentUserNombre?: string | null;
  currentUserCargo?: string | null;
  currentUserIniciales?: string | null;
}

function formatFecha(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

export function AnotacionesDrawer({
  open,
  onClose,
  escenarioId,
  escenarioNombre,
  currentUserId,
  currentUserNombre,
  currentUserCargo,
  currentUserIniciales,
}: AnotacionesDrawerProps) {
  const [anotaciones, setAnotaciones] = useState<Anotacion[]>([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function cargar() {
    if (!escenarioId) return;
    setCargando(true);
    setError(null);
    try {
      const sb = createAnyClient();
      const { data, error: err } = await sb
        .from("anotacion_escenario")
        .select("id, texto, creado_en, user_id")
        .eq("escenario_id", escenarioId)
        .order("creado_en", { ascending: true });
      if (err) throw err;

      // Resolver nombres de autores
      const userIds = [...new Set((data ?? []).map((r: any) => r.user_id))];
      let personaMap: Record<string, { nombre: string; cargo: string | null; iniciales: string | null }> = {};
      // Inyectar el usuario actual como fallback inmediato
      if (currentUserId && currentUserNombre) {
        personaMap[currentUserId] = { nombre: currentUserNombre, cargo: currentUserCargo ?? null, iniciales: currentUserIniciales ?? null };
      }
      if (userIds.length > 0) {
        const { data: personas } = await sb
          .from("persona")
          .select("auth_user_id, nombre, cargo, iniciales")
          .in("auth_user_id", userIds);
        (personas ?? []).forEach((p: any) => {
          if (p.auth_user_id) personaMap[p.auth_user_id] = { nombre: p.nombre, cargo: p.cargo ?? null, iniciales: p.iniciales ?? null };
        });
      }

      setAnotaciones(
        (data ?? []).map((r: any) => ({
          id: r.id,
          texto: r.texto,
          creado_en: r.creado_en,
          user_id: r.user_id,
          autor_nombre: personaMap[r.user_id]?.nombre ?? null,
          autor_cargo: personaMap[r.user_id]?.cargo ?? null,
          autor_iniciales: personaMap[r.user_id]?.iniciales ?? null,
        }))
      );
    } catch {
      setError("No se pudieron cargar las anotaciones.");
    } finally {
      setCargando(false);
    }
  }

  async function enviar() {
    const textoTrim = texto.trim();
    if (!textoTrim || !currentUserId || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const sb = createAnyClient();
      const { error: err } = await sb.from("anotacion_escenario").insert({
        escenario_id: escenarioId,
        user_id: currentUserId,
        texto: textoTrim,
      });
      if (err) throw err;
      setTexto("");
      await cargar();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch {
      setError("No se pudo guardar la anotación.");
    } finally {
      setEnviando(false);
    }
  }

  async function eliminar(id: string) {
    const sb = createAnyClient();
    await sb.from("anotacion_escenario").delete().eq("id", id);
    setAnotaciones((prev) => prev.filter((a) => a.id !== id));
  }

  useEffect(() => {
    if (open) cargar();
    else { setAnotaciones([]); setTexto(""); setError(null); }
  }, [open, escenarioId]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Anotaciones"
      subtitle={escenarioNombre}
      width="sm"
      footer={
        <div className="w-full flex gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            placeholder="Escribe un comentario… (Enter para enviar)"
            rows={2}
            disabled={!currentUserId || enviando}
            className="flex-1 resize-none text-[13px] border border-[#e8e8e8] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 placeholder:text-[#bbb] disabled:opacity-50"
          />
          <button
            onClick={enviar}
            disabled={!texto.trim() || !currentUserId || enviando}
            className="flex-shrink-0 flex items-center justify-center w-9 h-9 self-end rounded-lg bg-[#1a1a2e] text-white hover:bg-[#2d2d4a] disabled:opacity-40 transition-colors"
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      }
    >
      {cargando && (
        <div className="flex items-center justify-center py-12 text-[#aaa]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-[13px]">Cargando anotaciones…</span>
        </div>
      )}

      {!cargando && anotaciones.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-[#bbb]">
          <MessageSquare className="w-8 h-8 mb-3 opacity-40" />
          <p className="text-[13px] font-medium">Sin anotaciones aún</p>
          <p className="text-[12px] mt-1">Sé el primero en dejar un comentario sobre este escenario.</p>
        </div>
      )}

      {!cargando && anotaciones.length > 0 && (
        <div className="flex flex-col gap-4">
          {anotaciones.map((a) => {
            const esPropia = a.user_id === currentUserId;
            const inicial = a.autor_iniciales ?? a.autor_nombre?.charAt(0).toUpperCase() ?? "?";
            const color = getCargoColor(a.autor_cargo);
            return (
              <div key={a.id} className="flex gap-3">
                {/* Avatar */}
                <span
                  title={a.autor_nombre ?? "Usuario"}
                  style={{ background: color }}
                  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold mt-0.5"
                >
                  {inicial}
                </span>
                {/* Burbuja */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-[12px] font-semibold text-[#1a1a2e] truncate">
                      {a.autor_nombre ?? "Usuario"}
                    </span>
                    <span className="text-[10px] text-[#aaa] flex-shrink-0">{formatFecha(a.creado_en)}</span>
                    {esPropia && (
                      <button
                        onClick={() => eliminar(a.id)}
                        className="ml-auto flex-shrink-0 text-[#ccc] hover:text-red-400 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-[13px] text-[#333] leading-relaxed whitespace-pre-wrap break-words bg-[#f8f8f8] rounded-lg px-3 py-2">
                    {a.texto}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {error && (
        <p className="mt-4 text-[12px] text-red-500 text-center">{error}</p>
      )}
    </Drawer>
  );
}
