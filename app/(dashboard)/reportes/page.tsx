import { requireAuth } from "@/lib/auth";
import { ReportesClient } from "./ReportesClient";

export default async function ReportesPage() {
  await requireAuth();
  return <ReportesClient />;
}
