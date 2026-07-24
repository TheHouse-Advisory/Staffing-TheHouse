import { requireAdmin } from "@/lib/auth";
import { AnotacionesList } from "@/components/anotaciones/AnotacionesList";

export default async function AnotacionesPage() {
  await requireAdmin();

  return <AnotacionesList />;
}
