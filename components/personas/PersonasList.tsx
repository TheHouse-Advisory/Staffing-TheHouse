"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, UserX, UserCheck, ChevronRight } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { PersonaForm } from "./PersonaForm";
import type { Persona, RolSistema } from "@/lib/types/database";

interface PersonasListProps {
  rolActual: RolSistema | null;
}

export function PersonasList({ rolActual }: PersonasListProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desactivando, setDesactivando] = useState<Persona | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const isAdmin = rolActual === "admin";

  const load = useCallback(async () => {
    const supabase = createAnyClient();
    const { data } = await supabase
      .from("persona")
      .select("*")
      .order("apellido");
    setPersonas(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggleActivo = async () => {
    if (!desactivando) return;
    setActionLoading(true);
    const supabase = createAnyClient();
    await supabase
      .from("persona")
      .update({ activo: !desactivando.activo })
      .eq("id", desactivando.id);
    setDesactivando(null);
    setActionLoading(false);
    load();
  };

  if (loading) return <p className="text-sm text-[#888]">Cargando...</p>;

  const activas = personas.filter((p) => p.activo);
  const inactivas = personas.filter((p) => !p.activo);

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm text-[#888]">
            {activas.length} persona{activas.length !== 1 ? "s" : ""} activa{activas.length !== 1 ? "s" : ""}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setDrawerOpen(true)} size="sm">
            <Plus className="w-3.5 h-3.5" />
            Nueva persona
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {activas.map((p) => (
          <PersonaCard key={p.id} persona={p} isAdmin={isAdmin} onToggle={setDesactivando} />
        ))}
      </div>

      {inactivas.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-semibold text-[#aaa] uppercase tracking-widest mb-3">
            Inactivas ({inactivas.length})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {inactivas.map((p) => (
              <PersonaCard key={p.id} persona={p} isAdmin={isAdmin} onToggle={setDesactivando} />
            ))}
          </div>
        </div>
      )}

      <PersonaForm
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSuccess={load}
      />

      <ConfirmDialog
        open={!!desactivando}
        onClose={() => setDesactivando(null)}
        onConfirm={handleToggleActivo}
        loading={actionLoading}
        title={desactivando?.activo ? "Desactivar persona" : "Reactivar persona"}
        message={
          desactivando?.activo
            ? `¿Desactivar a ${desactivando?.nombre} ${desactivando?.apellido}? No aparecerá en el tablero ni podrá recibir nuevas asignaciones.`
            : `¿Reactivar a ${desactivando?.nombre} ${desactivando?.apellido}?`
        }
        confirmLabel={desactivando?.activo ? "Desactivar" : "Reactivar"}
      />
    </>
  );
}

function PersonaCard({
  persona,
  isAdmin,
  onToggle,
}: {
  persona: Persona;
  isAdmin: boolean;
  onToggle: (p: Persona) => void;
}) {
  const initials = `${persona.nombre[0]}${persona.apellido[0]}`.toUpperCase();

  return (
    <div className={`bg-white border rounded-xl p-4 flex items-center gap-3 group transition-all ${
      persona.activo
        ? "border-[#e8e8e8] hover:shadow-sm hover:border-[#d0d0d0]"
        : "border-[#f0f0f0] opacity-60"
    }`}>
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-[#4a90e2] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] truncate">
          {persona.nombre} {persona.apellido}
        </p>
        <p className="text-xs text-[#888] truncate">
          {persona.cargo_actual ?? "Sin cargo"}
        </p>
        {persona.rol_sistema && (
          <span className="text-[10px] px-1.5 py-0.5 bg-[#eaf4ff] text-[#1a5276] rounded-full font-medium">
            {persona.rol_sistema}
          </span>
        )}
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {isAdmin && (
          <button
            onClick={(e) => { e.preventDefault(); onToggle(persona); }}
            className="p-1.5 rounded-md hover:bg-[#f0f0f0] text-[#ccc] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            title={persona.activo ? "Desactivar" : "Reactivar"}
          >
            {persona.activo ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
          </button>
        )}
        <Link
          href={`/personas/${persona.id}`}
          className="flex items-center gap-1 text-[11px] text-[#888] hover:text-[#1a1a1a] px-2 py-1 rounded-md hover:bg-[#f5f5f5] transition-colors font-medium"
        >
          Ver <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
