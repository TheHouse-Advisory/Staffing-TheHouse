"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Mail, Ban, RotateCcw, Trash2, ShieldCheck } from "lucide-react";
import { getIniciales } from "@/lib/utils/iniciales";
import { createClient, createAnyClient } from "@/lib/supabase/client";
import {
  otorgarAcceso,
  cambiarRol,
  reenviarInvitacion,
  suspenderAcceso,
  reactivarAcceso,
  revocarAcceso,
} from "@/lib/auth/actions";
import { Button } from "@/components/ui/Button";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { FieldWrapper, Select } from "@/components/ui/FormField";
import { CARGO_COLORS, CARGO_COLOR_DEFAULT } from "@/lib/constants";
import type { Persona, RolSistema, EstadoAcceso } from "@/lib/types/database";

const ROL_OPTIONS = [
  { value: "proposer", label: "Proposer" },
  { value: "admin", label: "Admin" },
];

const ESTADO_BADGE: Record<EstadoAcceso, { label: string; bg: string; text: string }> = {
  invitada: { label: "Invitación pendiente", bg: "#fdf6e3", text: "#a16207" },
  activa: { label: "Activo", bg: "#dcf5e7", text: "#1e7e45" },
  suspendida: { label: "Suspendido", bg: "#fde8e8", text: "#b91c1c" },
};

export function AccesosManager() {
  const [accesos, setAccesos] = useState<Persona[]>([]);
  const [sinAcceso, setSinAcceso] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [miId, setMiId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmAccion, setConfirmAccion] =
    useState<{ tipo: "revocar" | "suspender"; persona: Persona } | null>(null);

  const sb = createAnyClient();

  const load = useCallback(async () => {
    const [conAcceso, sinRol] = await Promise.all([
      sb
        .from("persona")
        .select("*")
        .not("rol_sistema", "is", null)
        .eq("is_deleted", false)
        .order("apellido"),
      sb
        .from("persona")
        .select("*")
        .is("rol_sistema", null)
        .eq("activo", true)
        .eq("is_deleted", false)
        .eq("is_ex_houser", false)
        .order("apellido"),
    ]);
    setAccesos((conAcceso.data ?? []) as Persona[]);
    setSinAcceso((sinRol.data ?? []) as Persona[]);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await sb
        .from("persona")
        .select("id")
        .eq("auth_user_id", user.id)
        .single();
      setMiId(data?.id ?? null);
    })();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCambiarRol(persona: Persona, nuevoRol: RolSistema) {
    if (nuevoRol === persona.rol_sistema) return;
    setBusyId(persona.id);
    setFeedback(null);
    const r = await cambiarRol({ personaId: persona.id, rol: nuevoRol });
    setFeedback({ ok: r.ok, text: r.message });
    setBusyId(null);
    if (r.ok) load();
  }

  async function handleReenviar(persona: Persona) {
    setBusyId(persona.id);
    setFeedback(null);
    const r = await reenviarInvitacion({
      personaId: persona.id,
      origin: window.location.origin,
    });
    setFeedback({ ok: r.ok, text: r.message });
    setBusyId(null);
  }

  async function handleReactivar(persona: Persona) {
    setBusyId(persona.id);
    setFeedback(null);
    const r = await reactivarAcceso({ personaId: persona.id });
    setFeedback({ ok: r.ok, text: r.message });
    setBusyId(null);
    if (r.ok) load();
  }

  async function ejecutarConfirmacion() {
    if (!confirmAccion) return;
    const { tipo, persona } = confirmAccion;
    setBusyId(persona.id);
    setFeedback(null);
    const r =
      tipo === "revocar"
        ? await revocarAcceso({ personaId: persona.id })
        : await suspenderAcceso({ personaId: persona.id });
    setFeedback({ ok: r.ok, text: r.message });
    setBusyId(null);
    setConfirmAccion(null);
    if (r.ok) load();
  }

  if (loading) return <p className="text-sm text-[#888]">Cargando...</p>;

  return (
    <div className="max-w-3xl">
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#4a90e2]" />
          <p className="text-sm text-[#888]">
            {accesos.length} persona{accesos.length !== 1 ? "s" : ""} con acceso al sistema
          </p>
        </div>
        <Button size="sm" onClick={() => { setFeedback(null); setModalOpen(true); }}>
          <Plus className="w-3.5 h-3.5" />
          Agregar acceso
        </Button>
      </div>

      {feedback && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm border ${
            feedback.ok
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Lista de accesos */}
      {accesos.length === 0 ? (
        <div className="text-center py-14 text-[#888] border border-dashed border-[#e0e0e0] rounded-xl">
          <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Aún no hay personas con acceso al sistema.</p>
          <p className="text-xs mt-1">Usa “Agregar acceso” para invitar a la primera.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accesos.map((persona) => {
            const estado = (persona.acceso_estado ?? "invitada") as EstadoAcceso;
            const badge = ESTADO_BADGE[estado];
            const color = CARGO_COLORS[persona.cargo_actual ?? ""] ?? CARGO_COLOR_DEFAULT;
            const initials = getIniciales(persona.nombre, persona.apellido, persona.iniciales);
            const esYo = persona.id === miId;
            const busy = busyId === persona.id;

            return (
              <div
                key={persona.id}
                className="flex items-center gap-4 bg-white border border-[#e8e8e8] rounded-xl px-5 py-3.5"
              >
                {/* Avatar */}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {initials}
                </div>

                {/* Identidad */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px] truncate">
                    {persona.nombre} {persona.apellido}
                    {esYo && <span className="text-[11px] text-[#aaa] font-normal ml-1.5">(tú)</span>}
                  </p>
                  <p className="text-xs text-[#888] truncate">{persona.email}</p>
                </div>

                {/* Estado */}
                <span
                  className="text-[11px] px-2.5 py-1 rounded-full font-semibold flex-shrink-0"
                  style={{ background: badge.bg, color: badge.text }}
                >
                  {badge.label}
                </span>

                {/* Rol (editable) */}
                <div className="w-[130px] flex-shrink-0">
                  <Select
                    value={persona.rol_sistema ?? ""}
                    options={ROL_OPTIONS}
                    disabled={busy || esYo}
                    onChange={(e) =>
                      handleCambiarRol(persona, e.target.value as RolSistema)
                    }
                    className="!py-1.5 text-xs"
                  />
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {estado === "suspendida" ? (
                    <button
                      onClick={() => handleReactivar(persona)}
                      disabled={busy}
                      title="Reactivar acceso"
                      className="p-1.5 rounded-md hover:bg-[#f0fdf4] text-[#888] hover:text-[#16a34a] transition-colors disabled:opacity-40"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReenviar(persona)}
                      disabled={busy}
                      title={
                        estado === "invitada"
                          ? "Reenviar invitación"
                          : "Reenviar enlace de acceso"
                      }
                      className="p-1.5 rounded-md hover:bg-[#f0f6ff] text-[#888] hover:text-[#4a90e2] transition-colors disabled:opacity-40"
                    >
                      <Mail className="w-4 h-4" />
                    </button>
                  )}

                  {estado !== "suspendida" && (
                    <button
                      onClick={() => setConfirmAccion({ tipo: "suspender", persona })}
                      disabled={busy || esYo}
                      title={esYo ? "No puedes suspender tu propio acceso" : "Suspender acceso"}
                      className="p-1.5 rounded-md hover:bg-[#fff7ed] text-[#888] hover:text-[#c2700a] transition-colors disabled:opacity-30"
                    >
                      <Ban className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => setConfirmAccion({ tipo: "revocar", persona })}
                    disabled={busy || esYo}
                    title={esYo ? "No puedes quitarte tu propio acceso" : "Quitar acceso"}
                    className="p-1.5 rounded-md hover:bg-red-50 text-[#888] hover:text-red-500 transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Nota de roles */}
      <p className="text-xs text-[#aaa] mt-4 leading-relaxed">
        <strong className="text-[#888]">Proposer</strong>: puede proponer asignaciones.{" "}
        <strong className="text-[#888]">Admin</strong>: además gestiona accesos y configuración.
        Las personas sin acceso siguen disponibles como recurso de staffing en la sección Personas.
      </p>

      <OtorgarAccesoModal
        open={modalOpen}
        personas={sinAcceso}
        onClose={() => setModalOpen(false)}
        onResult={(r) => {
          setModalOpen(false);
          setFeedback({ ok: r.ok, text: r.text });
          if (r.ok) load();
        }}
      />

      <ConfirmDialog
        open={!!confirmAccion}
        onClose={() => setConfirmAccion(null)}
        onConfirm={ejecutarConfirmacion}
        loading={!!confirmAccion && busyId === confirmAccion.persona.id}
        title={
          confirmAccion?.tipo === "revocar"
            ? "Quitar acceso al sistema"
            : "Suspender acceso"
        }
        confirmLabel={confirmAccion?.tipo === "revocar" ? "Quitar acceso" : "Suspender"}
        message={
          confirmAccion?.tipo === "revocar"
            ? `${confirmAccion?.persona.nombre} ${confirmAccion?.persona.apellido} dejará de tener acceso al sistema y se le quitará el rol. Seguirá existiendo como persona del equipo.`
            : `${confirmAccion?.persona.nombre} ${confirmAccion?.persona.apellido} no podrá iniciar sesión hasta que reactives su acceso. Conserva su rol asignado.`
        }
      />
    </div>
  );
}

// ── Modal: otorgar un nuevo acceso ───────────────────────────────────────
function OtorgarAccesoModal({
  open,
  personas,
  onClose,
  onResult,
}: {
  open: boolean;
  personas: Persona[];
  onClose: () => void;
  onResult: (r: { ok: boolean; text: string }) => void;
}) {
  const [personaId, setPersonaId] = useState("");
  const [rol, setRol] = useState<RolSistema>("proposer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPersonaId("");
      setRol("proposer");
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const personaOptions = personas.map((p) => ({
    value: p.id,
    label: `${p.nombre} ${p.apellido} — ${p.email}`,
  }));

  async function handleSubmit() {
    if (!personaId) {
      setError("Selecciona una persona.");
      return;
    }
    setLoading(true);
    setError(null);
    const r = await otorgarAcceso({
      personaId,
      rol,
      origin: window.location.origin,
    });
    setLoading(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onResult({ ok: true, text: r.message });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar acceso al sistema"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            loading={loading}
            disabled={personas.length === 0}
          >
            Otorgar acceso e invitar
          </Button>
        </>
      }
    >
      {personas.length === 0 ? (
        <p className="text-sm text-[#666]">
          Todas las personas activas ya tienen acceso. Crea una persona nueva
          en la sección <strong>Personas</strong> para poder otorgarle acceso.
        </p>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <FieldWrapper
            label="Persona"
            required
            hint="Solo se listan personas del equipo que aún no tienen acceso."
          >
            <Select
              value={personaId}
              options={personaOptions}
              placeholder="Seleccionar persona"
              onChange={(e) => setPersonaId(e.target.value)}
            />
          </FieldWrapper>

          <FieldWrapper label="Rol en el sistema" required>
            <Select
              value={rol}
              options={ROL_OPTIONS}
              onChange={(e) => setRol(e.target.value as RolSistema)}
            />
            <p className="text-xs text-[#888]">
              {rol === "admin"
                ? "Acceso total: gestiona accesos, personas y configuración."
                : "Puede proponer asignaciones y ver la información de la plataforma."}
            </p>
          </FieldWrapper>

          <div className="p-3 rounded-lg bg-[#f0f6ff] border border-[#d6e6fb] text-xs text-[#3a5a7a] flex gap-2">
            <Mail className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>
              Se enviará un correo de invitación a la persona para que defina
              su contraseña y active su cuenta.
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
