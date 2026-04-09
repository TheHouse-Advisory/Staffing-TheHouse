"use client";

import { useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { CatalogoTab } from "@/components/configuracion/CatalogoTab";

type Tab = "industrias" | "capacidades" | "tematicas";

const TABS: { key: Tab; label: string; tabla: string; titulo: string }[] = [
  { key: "industrias",  label: "Industrias",  tabla: "cat_industria", titulo: "Industrias" },
  { key: "capacidades", label: "Capacidades", tabla: "cat_capacidad",  titulo: "Capacidades" },
  { key: "tematicas",   label: "Temáticas",   tabla: "cat_tematica",  titulo: "Temáticas" },
];

export default function ConfiguracionPage() {
  const [tab, setTab] = useState<Tab>("industrias");
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar titulo="Configuración" />
      <div className="flex-1 overflow-auto scrollbar-thin">
        {/* Tabs */}
        <div className="border-b border-[#e8e8e8] bg-white px-6">
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key
                    ? "border-[#4a90e2] text-[#4a90e2]"
                    : "border-transparent text-[#888] hover:text-[#555]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contenido */}
        <div className="p-6 max-w-2xl">
          <CatalogoTab tabla={current.tabla} titulo={current.titulo} />
        </div>
      </div>
    </div>
  );
}
