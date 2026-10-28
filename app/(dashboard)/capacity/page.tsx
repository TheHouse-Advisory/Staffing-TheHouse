import { requireAdmin } from "@/lib/auth";
import { CapacityClient } from "./CapacityClient";

export default async function CapacityPage() {
  // Solo admin y Personas (igual que el menú lateral): antes cualquier rol entraba por
  // enlace directo y podía escribir valores que la base rechazaba sin avisar
  await requireAdmin();
  return <CapacityClient />;
}
