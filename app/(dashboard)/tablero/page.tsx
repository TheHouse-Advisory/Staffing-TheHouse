import { requireAuth } from "@/lib/auth";
import { TableroClient } from "./TableroClient";

export default async function TableroPage() {
  await requireAuth();
  return <TableroClient />;
}
