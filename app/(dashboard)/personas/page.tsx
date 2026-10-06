import { requireAdmin } from "@/lib/auth";
import { PersonasClient } from "./PersonasClient";

export default async function PersonasPage() {
  await requireAdmin();
  return <PersonasClient />;
}
