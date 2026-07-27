import { requireAdmin } from "@/lib/auth";
import { MatrizTalentoClient } from "./MatrizTalentoClient";

export default async function MatrizTalentosPage() {
  // Solo admin: el resto de los roles no debe ver la evaluación de talento
  // (ver reportes/page.tsx, allowedRoles). Antes solo se ocultaba la tarjeta;
  // entrar directo por URL no tenía ningún freno.
  await requireAdmin();
  return <MatrizTalentoClient />;
}
