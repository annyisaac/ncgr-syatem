/**
 * Hatchery data access. Same jsonb-per-row convention as lib/db.ts, on the
 * shared Supabase project. Generic helpers keyed by table name.
 */

import { getSupabase } from "../supabase";

const inBrowser = () => typeof window !== "undefined";

export type HatcheryTable =
  | "batches"
  | "machine_readings"
  | "vaccinations"
  | "biosecurity_logs"
  | "maintenance_logs"
  | "chick_inventory"
  | "allocations"
  | "dispatches"
  | "receptions"
  | "store_readings"
  | "fumigations"
  | "machines"
  | "operators"
  | "chick_counts"
  | "box_logs"
  | "supplies"
  | "farm_visits"
  | "vaccine_requests"
  | "spare_parts"
  | "spare_part_requests"
  | "farms"
  | "flocks";

export async function fetchTable<T>(table: HatcheryTable): Promise<T[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from(table)
    .select("data")
    .order("updated_at", { ascending: true });
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return (data ?? []).map((r) => r.data as T);
}

export async function upsertRow<T extends { id: string }>(
  table: HatcheryTable,
  row: T
): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase()
    .from(table)
    .upsert(
      { id: row.id, data: row, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) throw new Error(`Could not save to ${table}: ${error.message}`);
}

export async function deleteRow(table: HatcheryTable, id: string): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase().from(table).delete().eq("id", id);
  if (error) throw new Error(`Could not delete from ${table}: ${error.message}`);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
