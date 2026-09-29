import { requireAuth } from "@/lib/auth";
import { AusenciasClient } from "./AusenciasClient";
import { esAdmin } from "@/lib/roles";

export default async function AusenciasPage() {
  const { rol } = await requireAuth();
  return <AusenciasClient isAdmin={esAdmin(rol)} />;
}
