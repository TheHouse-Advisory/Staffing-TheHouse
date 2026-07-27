import { requireAuth } from "@/lib/auth";
import { PersonasClient } from "./PersonasClient";

export default async function PersonasPage() {
  await requireAuth();
  return <PersonasClient />;
}
