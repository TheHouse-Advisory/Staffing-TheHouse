"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, AlertTriangle, CheckCircle, Circle, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { fLocal } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { fetchEngagementsConCobertura } from "@/lib/queries/engagements";
import { Button } from "@/components/ui/Button";
import { EngagementForm } from "./EngagementForm";
import { ESTADO_ENGAGEMENT } from "@/lib/constants";
import type { EngagementConCobertura } from "@/lib/queries/engagements";
import type { RolSistema } from "@/lib/types/database";

interface Props { rolActual: RolSistema | null; }

export function EngagementsList({ rolActual }: Props) {
  const [engagements, setEngagements] = useState<EngagementConCobertura[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAdmin = rolActual === "admin";

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await fetchEngagementsConCobertura(supabase);
    setEngagements(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm text-[#888]">Cargando...</p>;

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-[#888]">
          {engagements.length} engagement{engagements.length !== 1 ? "s" : ""}
        </p>
        {isAdmin && (
          <Button onClick={() => setDrawerOpen(true)} size="sm">
            <Plus className="w-3.5 h-3.5" /> Nuevo engagement
          </Button>
        )}
      </div>

      {engagements.length === 0 ? (
        <div className="text-center py-12 text-[#888]">
          <Circle className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">No hay engagements registrados.</p>
        </div>
      ) : (
        <div className="space-y-2 max-w-4xl">
          {engagements.map((e) => {
            const estilos = ESTADO_ENGAGEMENT[e.estado] ?? ESTADO_ENGAGEMENT.activo;
            return (
              <Link
                key={e.id}
                href={`/engagements/${e.id}`}
                className="group flex items-center gap-4 bg-white border border-[#e8e8e8] rounded-xl px-5 py-4 hover:shadow-sm hover:border-[#d0d0d0] transition-all"
              >
                {/* Nombre + cliente */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-semibold text-[15px] truncate">{e.nombre}</p>
                    {e.tiene_alerta && (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-sm text-[#888] truncate">{e.cliente}</p>
                </div>

                {/* Fechas */}
                {e.fecha_inicio && (
                  <p className="text-xs text-[#aaa] flex-shrink-0 hidden sm:block">
                    {format(fLocal(e.fecha_inicio), "d MMM", { locale: es })}
                    {e.fecha_fin_estimada && (
                      <> → {format(fLocal(e.fecha_fin_estimada), "d MMM yy", { locale: es })}</>
                    )}
                  </p>
                )}

                {/* Cobertura */}
                {e.requerimientos_total > 0 && (
                  <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                    e.tiene_alerta
                      ? "bg-amber-50 text-amber-700"
                      : "bg-[#dcf5e7] text-[#1e7e45]"
                  }`}>
                    {e.tiene_alerta
                      ? <AlertTriangle className="w-3 h-3" />
                      : <CheckCircle className="w-3 h-3" />}
                    {e.tiene_alerta ? "Sin cubrir" : "Cubierto"}
                  </span>
                )}

                {/* Estado */}
                <span
                  className="text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0"
                  style={{ background: estilos.bg, color: estilos.text }}
                >
                  {estilos.label}
                </span>

                {/* Ver detalle */}
                <ChevronRight className="w-4 h-4 text-[#ccc] group-hover:text-[#888] transition-colors flex-shrink-0" />
              </Link>
            );
          })}
        </div>
      )}

      <EngagementForm
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSuccess={load}
      />
    </>
  );
}
