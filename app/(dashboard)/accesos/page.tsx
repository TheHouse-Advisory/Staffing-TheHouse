/**
 * Página /accesos — gestión de accesos al sistema.
 *
 * Server Component: requireAdmin() valida en el SERVIDOR que quien entra
 * es administrador. Un usuario sin rol admin es redirigido antes de que
 * se renderice nada. Esta es la barrera de backend; el Sidebar solo
 * oculta el enlace (barrera de frontend).
 */
import { requireAdmin } from "@/lib/auth";
import { Topbar } from "@/components/layout/Topbar";
import { AccesosManager } from "@/components/accesos/AccesosManager";

export default async function AccesosPage() {
  await requireAdmin();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar titulo="Accesos al sistema" />
      <div className="flex-1 overflow-auto scrollbar-thin p-6">
        <AccesosManager />
      </div>
    </div>
  );
}
