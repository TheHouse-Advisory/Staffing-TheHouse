"use client";

import { useState, useEffect } from "react";
import { createAnyClient } from "@/lib/supabase/client";
import { getProyectosActivos, getPersonasAsignadas, crearViaje } from "@/lib/queries/ausencias";
import { Modal } from "@/components/ui/Modal";
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
    if (!engagementId) return;
    setCargandoPersonas(true);
    getPersonasAsignadas(createAnyClient(), engagementId).then((data) => {
      setPersonas(data.map((p) => ({ value: p.id, label: `${p.nombre} ${p.apellido}` })));
      setCargandoPersonas(false);
    });
  }, [engagementId]);

  async function handleGuardar() {
    if (!engagementId || personaIds.length === 0 || !desde || !hasta) {
      setError("Completa engagement, al menos una persona y fechas.");
      return;
    }
    if (hasta < desde) {
      setError("La fecha \"Hasta\" no puede ser anterior a \"Desde\".");
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
          <Button onClick={handleGuardar} loading={guardando}>Guardar</Button>
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

        <FieldWrapper label="Nota">
          <Textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
        </FieldWrapper>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}
