import { requireAdmin } from "@/lib/auth";
import { DescargablesClient } from "./DescargablesClient";

export default async function DescargablesPage() {
  await requireAdmin();
  return <DescargablesClient />;
}
