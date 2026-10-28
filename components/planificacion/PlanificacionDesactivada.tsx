import Link from "next/link";
import { Construction } from "lucide-react";

/**
 * Aviso bloqueante de Planificación. La sección tiene problemas técnicos sin resolver
 * (ver auditoría) y no está en uso, así que se desactiva temporalmente: la herramienta
 * no se carga y el aviso no se puede cerrar, solo volver a otra sección.
 */
export function PlanificacionDesactivada() {
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="planif-titulo"
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-7 text-center"
      >
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
          <Construction className="w-7 h-7 text-amber-600" />
        </div>
        <h2 id="planif-titulo" className="text-[18px] font-bold text-[#1a1a2e] mb-2">
          Planificación desactivada temporalmente
        </h2>
        <p className="text-[13px] text-[#555] leading-relaxed mb-3">
          Esta sección tiene problemas técnicos sin resolver, por lo que fue desmantelada
          temporalmente mientras se corrigen.
        </p>
        <p className="text-[13px] text-[#555] leading-relaxed mb-6">
          Actualmente no está en uso, así que su desactivación <strong>no afecta</strong> el
          funcionamiento del resto de la aplicación: puedes seguir usando Inicio, Tablero,
          Proyectos y las demás secciones con normalidad.
        </p>
        <Link
          href="/tablero"
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-[#1a1a2e] text-white text-sm font-semibold hover:bg-[#2d2d4e] transition-colors"
        >
          Volver al Tablero
        </Link>
      </div>
    </div>
  );
}
