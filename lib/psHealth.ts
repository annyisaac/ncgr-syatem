/**
 * Parent Stock — health records: vaccination, medication, biosecurity and
 * mortality investigation. One ps_health table with a `kind` discriminator.
 *
 * Vet-facing: schedules and reminders for vaccines due and medicines expiring;
 * withdrawal periods on treatments; biosecurity compliance and incidents;
 * post-mortem findings and disposal on mortality investigations.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";

export type HealthKind = "vaccination" | "medication" | "biosecurity" | "mortality";

interface BaseRec {
  id: string;
  kind: HealthKind;
  date: string;
  flockId?: string;
  flockCode?: string;
  notes?: string;
  by: string;
  on: string;
}

export const VACCINE_ROUTES = ["Drinking water", "Spray", "Eye drop", "Injection (S/C)", "Injection (I/M)", "Wing web"] as const;
export const VACCINATION_STATUSES = ["Scheduled", "Given", "Missed"] as const;
export type VaccinationStatus = (typeof VACCINATION_STATUSES)[number];
export interface VaccinationRec extends BaseRec {
  kind: "vaccination";
  vaccine: string;
  batchNo?: string;
  expiry?: string;
  route?: string;
  doses?: number;
  ageWeeks?: number;
  status: VaccinationStatus;
  administeredBy?: string;
}

export const MED_MOVEMENTS = ["Received", "Issued", "Treatment"] as const;
export type MedMovement = (typeof MED_MOVEMENTS)[number];
export interface MedicationRec extends BaseRec {
  kind: "medication";
  medicine: string;
  movement: MedMovement;
  quantity?: number;
  unit?: string;
  reason?: string;
  withdrawalDays?: number;
  withdrawalUntil?: string;
  administeredBy?: string;
}

export const BIOSECURITY_TYPES = [
  "Visitor", "Footbath", "Vehicle disinfection", "House sanitation", "Equipment sanitation",
  "Pest control", "Rodent control", "Protective clothing", "Inspection", "Incident",
] as const;
export interface BiosecurityRec extends BaseRec {
  kind: "biosecurity";
  type: string;
  location?: string;
  compliant?: boolean;
  incident?: boolean;
  severity?: string;
  actionTaken?: string;
}

export const DISPOSAL_METHODS = ["Incineration", "Burial pit", "Composting", "Rendering", "Other"] as const;
export interface MortalityRec extends BaseRec {
  kind: "mortality";
  house?: string;
  quantity: number;
  ageWeeks?: number;
  cause?: string;
  postMortem?: string;
  disposalMethod?: string;
}

export type HealthRecord = VaccinationRec | MedicationRec | BiosecurityRec | MortalityRec;

// ---- Derived / alerts -----------------------------------------------------

const daysUntil = (dateISO: string | undefined, todayISO: string) =>
  dateISO ? Math.round((Date.parse(dateISO) - Date.parse(todayISO)) / 86_400_000) : null;

/** Vaccinations still to give, soonest first (Scheduled, not past-and-missed). */
export function vaccinationsDue(records: HealthRecord[]): VaccinationRec[] {
  return records.filter((r): r is VaccinationRec => r.kind === "vaccination" && r.status === "Scheduled")
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
/** Vaccine/medicine batches expiring within 30 days or already expired. */
export function expiringStock(records: HealthRecord[], todayISO: string): { label: string; expiry: string; days: number }[] {
  const out: { label: string; expiry: string; days: number }[] = [];
  for (const r of records) {
    const exp = r.kind === "vaccination" ? r.expiry : undefined;
    if (!exp) continue;
    const d = daysUntil(exp, todayISO);
    if (d !== null && d <= 30) out.push({ label: `${(r as VaccinationRec).vaccine}${(r as VaccinationRec).batchNo ? ` · ${(r as VaccinationRec).batchNo}` : ""}`, expiry: exp, days: d });
  }
  return out.sort((a, b) => a.days - b.days);
}
/** Treatments whose withdrawal period has not yet passed (eggs/meat withheld). */
export function activeWithdrawals(records: HealthRecord[], todayISO: string): MedicationRec[] {
  return records.filter((r): r is MedicationRec => r.kind === "medication" && !!r.withdrawalUntil && r.withdrawalUntil >= todayISO)
    .sort((a, b) => ((a.withdrawalUntil ?? "") < (b.withdrawalUntil ?? "") ? -1 : 1));
}

export const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// ---- Storage --------------------------------------------------------------

export async function listHealth(): Promise<HealthRecord[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("ps_health").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load health records: ${error.message}`);
  return (data ?? []).map((r) => r.data as HealthRecord);
}
export async function upsertHealth(r: HealthRecord): Promise<void> {
  const { error } = await getSupabase().from("ps_health").upsert({ id: r.id, data: r, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save health record: ${error.message}`);
}
export const newHealthId = (kind: string) => `psh_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
