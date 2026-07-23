/**
 * Fixed assets + straight-line depreciation, auto-posted to the ledger.
 *
 * Monthly depreciation entry (per asset, per month, deterministic id):
 *   Dr Depreciation Expense (6080) / Cr Accumulated Depreciation (1590)
 */

import { getSupabase } from "./supabase";
import type { JournalEntry } from "./accounting";

const inBrowser = () => typeof window !== "undefined";
const round0 = (n: number) => Math.round(n);

export interface FixedAsset {
  id: string;
  name: string;
  category?: string;
  purchaseDate: string; // YYYY-MM-DD
  cost: number;
  salvage?: number;
  usefulLifeYears: number;
  active: boolean;
  by: string;
  on: string;
}

// ---- Month math -----------------------------------------------------------

const ymIndex = (m: string) => { const [y, mo] = m.split("-").map(Number); return y * 12 + (mo - 1); };
const monthFromIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
export const monthsBetween = (a: string, b: string) => ymIndex(b) - ymIndex(a);
export const addMonths = (a: string, n: number) => monthFromIndex(ymIndex(a) + n);
export const currentMonth = (todayISO: string) => todayISO.slice(0, 7);

// ---- Depreciation ---------------------------------------------------------

export function depreciable(a: FixedAsset): number { return Math.max(0, a.cost - (a.salvage || 0)); }
export function totalMonths(a: FixedAsset): number { return Math.max(1, Math.round(a.usefulLifeYears * 12)); }
export function monthlyDep(a: FixedAsset): number { return round0(depreciable(a) / totalMonths(a)); }

/** Months of depreciation elapsed up to (and including) `asOfMonth`, capped. */
export function monthsElapsed(a: FixedAsset, asOfMonth: string): number {
  const start = a.purchaseDate.slice(0, 7);
  return Math.max(0, Math.min(totalMonths(a), monthsBetween(start, asOfMonth) + 1));
}
export function accumulatedDep(a: FixedAsset, asOfMonth: string): number {
  return Math.min(depreciable(a), monthlyDep(a) * monthsElapsed(a, asOfMonth));
}
export function bookValue(a: FixedAsset, asOfMonth: string): number {
  return round0(a.cost - accumulatedDep(a, asOfMonth));
}

// ---- Storage --------------------------------------------------------------

export async function listAssets(): Promise<FixedAsset[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("fixed_assets").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load assets: ${error.message}`);
  return (data ?? []).map((r) => r.data as FixedAsset);
}
export async function upsertAsset(a: FixedAsset): Promise<void> {
  const { error } = await getSupabase().from("fixed_assets").upsert({ id: a.id, data: a, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save asset: ${error.message}`);
}
export const newAssetId = () => `fa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ---- GL posting -----------------------------------------------------------

export function deriveDepreciationEntries(assets: FixedAsset[], asOfMonth: string): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const a of assets) {
    if (!a.active) continue;

    // Acquisition: put the asset on the books. Credited to Owner's Capital by
    // default (asset introduced to the business); adjust with a manual journal
    // if it was funded from bank/cash/payable instead.
    if (a.cost > 0) {
      out.push({
        id: `je_asset_acq_${a.id}`,
        date: a.purchaseDate,
        ref: `ASSET-${a.id.slice(-6)}`,
        narration: `Asset acquired — ${a.name}`,
        lines: [
          { accountCode: "1500", debit: a.cost, credit: 0 },
          { accountCode: "3000", debit: 0, credit: a.cost },
        ],
        status: "posted",
        source: "assets",
        createdBy: "system",
        on: `${a.purchaseDate}T00:00:00Z`,
        postedBy: "system",
        postedOn: `${a.purchaseDate}T00:00:00Z`,
      });
    }

    const dep0 = depreciable(a);
    if (dep0 <= 0) continue;
    const tm = totalMonths(a);
    const monthly = monthlyDep(a);
    const start = a.purchaseDate.slice(0, 7);
    const n = monthsElapsed(a, asOfMonth);
    for (let m = 0; m < n; m++) {
      const month = addMonths(start, m);
      const dep = m === tm - 1 ? dep0 - monthly * (tm - 1) : monthly;
      if (dep <= 0) continue;
      out.push({
        id: `je_depr_${a.id}_${month}`,
        date: `${month}-28`,
        ref: `DEPR-${month}`,
        narration: `Depreciation — ${a.name} (${month})`,
        lines: [
          { accountCode: "6080", debit: dep, credit: 0 },
          { accountCode: "1590", debit: 0, credit: dep },
        ],
        status: "posted",
        source: "assets",
        createdBy: "system",
        on: `${month}-28T00:00:00Z`,
        postedBy: "system",
        postedOn: `${month}-28T00:00:00Z`,
      });
    }
  }
  return out;
}

export function depreciationEntriesToSync(assets: FixedAsset[], asOfMonth: string, existing: JournalEntry[]): JournalEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const sig = (e: JournalEntry) => `${e.date}|${e.status}|${JSON.stringify(e.lines)}`;
  return deriveDepreciationEntries(assets, asOfMonth).filter((d) => { const cur = byId.get(d.id); return !cur || sig(cur) !== sig(d); });
}
