import { requireAuth } from "@/lib/auth";
import { EngagementsClient } from "./EngagementsClient";

export default async function EngagementsPage() {
  await requireAuth();
  return <EngagementsClient />;
}
