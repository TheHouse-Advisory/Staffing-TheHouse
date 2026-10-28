"use client";

import { useState, useEffect } from "react";
import { createAnyClient } from "@/lib/supabase/client";
import { getProyectosActivos, getPersonasAsignadas, crearViaje } from "@/lib/queries/ausencias";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, Input, Select, Textarea } from "@/components/ui/FormField";
import { MultiSelect } from "@/components/ui/MultiSelect";

interface ModalNuevoViajeProps {
  open: boolean;
  onClose: () => void;
  onGuardado?: () => void;
}

type Opcion = { value: string; label: string };

export function ModalNuevoViaje({ open, onClose, onGuardado }: ModalNuevoViajeProps) {
  const [proyectos, setProyectos] = useState<Opcion[]>([]);
  const [personas, setPersonas] = useState<Opcion[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [nota, setNota] = useState("");
  const [cargandoPersonas, setCargandoPersonas] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangoEng, setRangoEng] = useState<{ inicio: string | null; fin: string | null } | null>(null);
  const [confirmFuera, setConfirmFuera] = useState(false);

  // Reset + carga de proyectos activos al abrir
  useEffect(() => {
    if (!open) return;
    setEngagementId(""); setPersonaIds([]); setDesde(""); setHasta(""); setNota(""); setError(null);
    getProyectosActivos(createAnyClient()).then((data) =>
      setProyectos(data.map((e) => ({ value: e.id, label: e.cliente ? `${e.nombre} — ${e.cliente}` : e.nombre })))
    );
  }, [open]);

  // Personas staffeadas en el engagement elegido
  useEffect(() => {
    setPersonaIds([]);
    setPersonas([]);
    setRangoEng(null);
    if (!engagementId) return;
    setCargandoPersonas(true);
    const sb = createAnyClient();
    getPersonasAsignadas(sb, engagementId).then((data) => {
      setPersonas(data.map((p) => ({ value: p.id, label: `${p.nombre} ${p.apellido}` })));
      setCargandoPersonas(false);
    });
    // Rango del engagement (incluidas sus extensiones): el viaje debe caer dentro para verse
    Promise.all([
      sb.from("engagement").select("fecha_inicio, fecha_fin_estimada, fecha_fin_real").eq("id", engagementId).single(),
      sb.from("engagement_extension").select("fecha_fin").eq("engagement_id", engagementId),
    ]).then(([engRes, extRes]: any[]) => {
      const e = engRes.data;
      if (!e) return;
      const fines = [e.fecha_fin_real ?? e.fecha_fin_estimada, ...((extRes.data ?? []) as { fecha_fin: string }[]).map((x) => x.fecha_fin)]
        .filter(Boolean) as string[];
      setRangoEng({ inicio: e.fecha_inicio ?? null, fin: fines.length ? fines.sort().at(-1)! : null });
    });
  }, [engagementId]);

  async function handleGuardar(fueraConfirmado = false) {
    if (!engagementId || personaIds.length === 0 || !desde || !hasta) {
      setError("Completa engagement, al menos una persona y fechas.");
      return;
    }
    if (hasta < desde) {
      setError("La fecha \"Hasta\" no puede ser anterior a \"Desde\".");
      return;
    }
    // Fuera de las fechas del engagement se permite, pero confirmando primero
    // (en el Tablero se mostrará solo el ícono del viaje en esas semanas)
    if (!fueraConfirmado && rangoEng && ((rangoEng.inicio && desde < rangoEng.inicio) || (rangoEng.fin && hasta > rangoEng.fin))) {
      setConfirmFuera(true);
      return;
    }
    setGuardando(true);
    setError(null);
    const { error: err } = await crearViaje(createAnyClient(), {
      engagement_id: engagementId,
      persona_ids: personaIds,
      nombres: Object.fromEntries(personas.map((p) => [p.value, p.label])),
      fecha_inicio: desde,
      fecha_fin: hasta,
      nota,
    });
    setGuardando(false);
    if (err) { setError(err); return; }
    onGuardado?.();
    onClose();
  }

  const placeholderPersona = !engagementId
    ? "Primero elige un engagement"
    : cargandoPersonas
      ? "Cargando..."
      : personas.length === 0
        ? "Sin personas asignadas"
        : "Selecciona una o más personas";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo viaje"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => handleGuardar()} loading={guardando}>Guardar</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FieldWrapper label="Engagement (Proyecto)" required>
          <Select
            value={engagementId}
            onChange={(e) => setEngagementId(e.target.value)}
            options={proyectos}
            placeholder="Selecciona un proyecto"
          />
        </FieldWrapper>

        <FieldWrapper label="Personas" required>
          <MultiSelect
            value={personaIds}
            onChange={setPersonaIds}
            options={personas}
            placeholder={placeholderPersona}
            disabled={!engagementId || personas.length === 0}
          />
        </FieldWrapper>

        <div className="grid grid-cols-2 gap-3">
          <FieldWrapper label="Desde" required>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </FieldWrapper>
          <FieldWrapper label="Hasta" required>
            <Input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </FieldWrapper>
        </div>
        {rangoEng && (
          <p className="text-[11px] text-[#888] -mt-1">
            Fechas del engagement: {rangoEng.inicio ?? "…"} a {rangoEng.fin ?? "…"}
          </p>
        )}

        <FieldWrapper label="Nota">
          <Textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
        </FieldWrapper>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {/* Aviso: viaje fuera de las fechas del engagement */}
      <ConfirmDialog
        open={confirmFuera}
        onClose={() => setConfirmFuera(false)}
        onConfirm={() => { setConfirmFuera(false); void handleGuardar(true); }}
        title="Viaje fuera de las fechas del engagement"
        confirmLabel="Confirmar"
        message={`Las fechas del viaje (${desde} a ${hasta}) quedan fuera del engagement (${rangoEng?.inicio ?? "…"} a ${rangoEng?.fin ?? "…"}). Se guardará igual y en el Tablero se mostrará solo el ícono de viaje en esas semanas, sin la barra del proyecto. ¿Quieres continuar?`}
      />
    </Modal>
  );
}
