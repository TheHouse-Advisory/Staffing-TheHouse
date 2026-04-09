/**
 * Tipo canónico del cliente Supabase tipado para este proyecto.
 * Usar este tipo en query helpers en lugar de SupabaseClient<Database>
 * para evitar incompatibilidades entre versiones de @supabase/ssr y supabase-js.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";

export type TypedSupabaseClient = ReturnType<
  typeof createBrowserClient<Database>
>;
