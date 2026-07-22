"use client";

// Estado compartido de cargos colapsados/desplegables — sincroniza
// Inicio > Cuadrante Tablero y Tablero > Vista Proyectos (ambos montan
// DesgloceEngagements bajo layout.tsx, que no se desmonta al navegar entre rutas).
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

const STORAGE_KEY = "collapsed_roles_state";

interface CargosColapsadosCtx {
  colapsados: Set<string>;
  toggle: (key: string) => void;
}

const Ctx = createContext<CargosColapsadosCtx | null>(null);

function leerInicial(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function CargosColapsadosProvider({ children }: { children: ReactNode }) {
  const [colapsados, setColapsados] = useState<Set<string>>(leerInicial);

  const toggle = useCallback((key: string) => {
    setColapsados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ colapsados, toggle }}>{children}</Ctx.Provider>;
}

export function useCargosColapsados() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCargosColapsados debe usarse dentro de CargosColapsadosProvider");
  return ctx;
}
