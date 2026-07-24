import type { ReactNode } from "react";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cuenta las coincidencias de `query` (insensible a mayúsculas) dentro de `text`. */
export function countMatches(text: string, query: string): number {
  const q = query.trim();
  if (!q) return 0;
  const regex = new RegExp(escapeRegExp(q), "gi");
  return (text.match(regex) || []).length;
}

/**
 * Envuelve las coincidencias de `query` dentro de `text` en <mark>. Si `query` está vacío, retorna el texto intacto.
 * `activeIndex` (global, across combined text blocks) resalta esa coincidencia como "activa".
 * `offset` es el número de coincidencias que preceden a este bloque de texto (para blocks concatenados, ej. titulo + contenido).
 */
export function highlightText(
  text: string,
  query: string,
  activeIndex?: number,
  offset: number = 0
): ReactNode {
  const q = query.trim();
  if (!q) return text;

  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
  let matchCounter = 0;

  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const globalIndex = offset + matchCounter;
      matchCounter++;
      const isActive = activeIndex === globalIndex;
      return (
        <mark
          key={i}
          id={activeIndex !== undefined ? `search-match-${globalIndex}` : undefined}
          className={
            isActive
              ? "bg-amber-400 text-black font-bold ring-2 ring-amber-600 rounded-sm px-0.5"
              : "bg-yellow-200 text-black px-0.5 rounded-sm"
          }
        >
          {part}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
