"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface Props {
  open: boolean;
  nombre: string;
  loading?: boolean;
  onClose: () => void;
  onArchivar: () => void;
  onEliminar: () => void;
}

/** Modal de decisión al eliminar un engagement: archivar (estado='terminado') vs papelera (is_deleted). */
export function ArchivarEliminarModal({ open, nombre, loading = false, onClose, onArchivar, onEliminar }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="¿Qué deseas hacer con este proyecto?"
      footer={
        <>
          <button onClick={onClose} disabled={loading}
            className="text-sm text-[#888] hover:text-[#555] disabled:opacity-50 mr-auto">
            Cancelar
          </button>
          <Button variant="primary" onClick={onArchivar} loading={loading}>
            Mover al Archivo Histórico
          </Button>
          <Button variant="danger" onClick={onEliminar} loading={loading}>
            Eliminar Definitivamente
          </Button>
        </>
      }
    >
      <p className="text-sm text-[#555]">
        <span className="font-semibold text-[#1a1a1a]">"{nombre}"</span> desaparecerá de inmediato del tablero, del desglose de inicio y de la planificación en cualquiera de los dos casos.
      </p>
    </Modal>
  );
}
