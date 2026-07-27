import { requireAuth } from "@/lib/auth";
import { AusenciasClient } from "./AusenciasClient";

export default async function AusenciasPage() {
  await requireAuth();
  return <AusenciasClient />;
}
