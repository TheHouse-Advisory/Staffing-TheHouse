import { requireAuth } from "@/lib/auth";
import { ConfiguracionClient } from "./ConfiguracionClient";

export default async function ConfiguracionPage() {
  await requireAuth();
  return <ConfiguracionClient />;
}
