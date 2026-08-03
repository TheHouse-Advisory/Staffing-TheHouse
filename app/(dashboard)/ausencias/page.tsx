import { requireAuth } from "@/lib/auth";
import { AusenciasClient } from "./AusenciasClient";

export default async function AusenciasPage() {
  const { rol } = await requireAuth();
  return <AusenciasClient isAdmin={rol === "admin"} />;
}
