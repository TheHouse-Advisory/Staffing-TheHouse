"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Briefcase, CornerDownLeft } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";

interface PersonaResult {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
}

interface EngagementResult {
  id: string;
  nombre: string;
  cliente: string | null;
  estado: string;
}

type Resultado =
  | { tipo: "persona"; item: PersonaResult }
  | { tipo: "engagement"; item: EngagementResult };

/** Paleta global (Ctrl+K / Cmd+K) para saltar a una persona o engagement. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [activo, setActivo] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Atajo global de apertura/cierre
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResultados([]);
      setActivo(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Búsqueda con debounce en persona + engagement
  useEffect(() => {
    if (!query.trim()) {
      setResultados([]);
      return;
    }
    const t = query.trim();
    setLoading(true);
    const timeout = setTimeout(async () => {
      const sb = createAnyClient();
      const [personas, engagements] = await Promise.all([
        sb
          .from("persona")
          .select("id, nombre, apellido, cargo_actual")
          .or(`nombre.ilike.%${t}%,apellido.ilike.%${t}%`)
          .limit(5),
        sb
          .from("engagement")
          .select("id, nombre, cliente, estado")
          .eq("is_deleted", false)
          .or(`nombre.ilike.%${t}%,cliente.ilike.%${t}%`)
          .limit(5),
      ]);

      const items: Resultado[] = [
        ...((personas.data ?? []) as PersonaResult[]).map(
          (item) => ({ tipo: "persona" as const, item })
        ),
        ...((engagements.data ?? []) as EngagementResult[]).map(
          (item) => ({ tipo: "engagement" as const, item })
        ),
      ];
      setResultados(items);
      setActivo(0);
      setLoading(false);
    }, 250);

    return () => clearTimeout(timeout);
  }, [query]);

  const irA = useCallback(
    (r: Resultado) => {
      setOpen(false);
      router.push(
        r.tipo === "persona"
          ? `/personas/${r.item.id}`
          : `/engagements/${r.item.id}`
      );
    },
    [router]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && resultados[activo]) {
      irA(resultados[activo]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        onClick={() => setOpen(false)}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#e8e8e8]">
          <Search className="w-4 h-4 text-[#999] flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar persona o engagement..."
            className="flex-1 text-[14px] outline-none placeholder:text-[#aaa]"
          />
          <kbd className="text-[10px] text-[#999] border border-[#e0e0e0] rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        <div className="max-h-[320px] overflow-auto scrollbar-thin">
          {loading && (
            <div className="px-4 py-6 text-center text-[13px] text-[#999]">
              Buscando...
            </div>
          )}

          {!loading && query.trim() && resultados.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-[#999]">
              Sin resultados para "{query}"
            </div>
          )}

          {!loading &&
            resultados.map((r, i) => (
              <button
                key={`${r.tipo}-${r.item.id}`}
                onClick={() => irA(r)}
                onMouseEnter={() => setActivo(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === activo ? "bg-[#f5f5f5]" : ""
                }`}
              >
                {r.tipo === "persona" ? (
                  <User className="w-4 h-4 text-[#666] flex-shrink-0" />
                ) : (
                  <Briefcase className="w-4 h-4 text-[#666] flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate">
                    {r.tipo === "persona"
                      ? `${r.item.nombre} ${r.item.apellido}`
                      : r.item.nombre}
                  </p>
                  <p className="text-[11px] text-[#999] truncate">
                    {r.tipo === "persona"
                      ? r.item.cargo_actual ?? "Sin cargo"
                      : r.item.cliente ?? r.item.estado}
                  </p>
                </div>
                {i === activo && (
                  <CornerDownLeft className="w-3.5 h-3.5 text-[#bbb] flex-shrink-0" />
                )}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
