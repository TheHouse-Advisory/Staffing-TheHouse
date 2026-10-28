import { requireAdmin } from "@/lib/auth";
import { ConfiguracionClient } from "./ConfiguracionClient";

export default async function ConfiguracionPage() {
  // Solo admin y Personas (igual que el menú lateral): antes cualquier rol entraba por
  // enlace directo y veía botones que la base rechazaba sin avisar
  await requireAdmin();
  return <ConfiguracionClient />;
}
