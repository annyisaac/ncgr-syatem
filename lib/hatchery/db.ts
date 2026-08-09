/**
 * Hatchery data access. Same jsonb-per-row convention as lib/db.ts, on the
 * shared Supabase project. Generic helpers keyed by table name.
 */

import { getSupabase } from "../supabase";
import type { Batch, Machine, Reception } from "./types";

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
  | "box_targets"
  | "supplies"
  | "farm_visits"
  | "vaccine_requests"
  | "spare_parts"
  | "spare_part_requests"
  | "farms"
  | "flocks"
  | "machine_issues"
  | "shift_handovers";

// PostgREST caps every response at ~1000 rows, so a single select silently
// truncates any table that has grown past that (machine_readings hit this at
// 2500+ rows, hiding every reading after the 1000th). Page through with
// .range() until a short page proves we've reached the end.
const PAGE = 1000;

export async function fetchTable<T>(table: HatcheryTable): Promise<T[]> {
  if (!inBrowser()) return [];
  const sb = getSupabase();
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select("data")
      .order("updated_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load ${table}: ${error.message}`);
    const rows = (data ?? []).map((r) => r.data as T);
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
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

/**
 * Change a batch's code. Batch codes are locked at the DB level (a stray
 * whole-row write must never revert one), so the only way to change one is this
 * authorized RPC — gated server-side to Admin / Hatchery Manager, with the
 * length + uniqueness checks enforced there too. History is appended by the
 * caller's own row write; this only flips the code.
 */
export async function setBatchNo(id: string, batchNo: string): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase().rpc("set_batch_no", { p_id: id, p_no: batchNo });
  if (error) throw new Error(error.message);
}

/**
 * Set a batch atomically: the batch, its contributing receptions, and the
 * affected setter machines are written in a single server-side transaction
 * (the set_hatchery_batch RPC). This replaces the old fire-and-forget path
 * where the batch could save while a reception link silently failed, leaving
 * eggs that looked "ready to set" and could be set twice.
 */
export async function commitBatchSet(
  batch: Batch,
  receptions: Reception[],
  machines: Machine[]
): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase().rpc("set_hatchery_batch", {
    p_batch: batch,
    p_receptions: receptions,
    p_machines: machines,
  });
  if (error) throw new Error(error.message);
}

/**
 * Delete a batch atomically: its eggs return to the contributing receptions and
 * the setter machines are freed in the SAME transaction as the batch delete
 * (the delete_hatchery_batch RPC) — so eggs can never be lost or double-counted
 * by a half-completed deletion.
 */
export async function commitBatchDelete(
  batchId: string,
  receptions: Reception[],
  machines: Machine[]
): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase().rpc("delete_hatchery_batch", {
    p_batch_id: batchId,
    p_receptions: receptions,
    p_machines: machines,
  });
  if (error) throw new Error(error.message);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
