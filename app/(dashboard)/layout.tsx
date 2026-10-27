import { requireAuth } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";

// Validación en servidor: sesión verificada (getUser), persona vinculada,
// con rol y no suspendida. Si falla, requireAuth redirige a /login.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  return <DashboardShell>{children}</DashboardShell>;
}
