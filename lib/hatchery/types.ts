/**
 * Hatchery domain types. Same storage convention as the sales side:
 * each row is { id, data: <this type>, updated_at } in its Supabase table.
 * Every record carries the acting user + timestamp for traceability.
 */

import type { Product } from "../types";

// ---------------------------------------------------------------------------
// Batch traceability
// ---------------------------------------------------------------------------

export interface LifecycleStepDef {
  key: string;
  label: string;
}

/** The 15-step batch lifecycle (egg receiving → delivery confirmation). */
export const LIFECYCLE_STEPS: LifecycleStepDef[] = [
  { key: "egg-receiving", label: "Egg receiving" },
  { key: "quality-inspection", label: "Quality inspection" },
  { key: "storage", label: "Storage" },
  { key: "setting", label: "Setting" },
  { key: "incubation", label: "Incubation" },
  { key: "candling-1", label: "Candling 1 (day 10)" },
  { key: "candling-2", label: "Candling 2 (day 18)" },
  { key: "transfer", label: "Transfer" },
  { key: "hatching", label: "Hatching" },
  { key: "chick-pulling", label: "Chick pulling" },
  { key: "grading", label: "Grading" },
  { key: "vaccination", label: "Vaccination" },
  { key: "boxing", label: "Boxing" },
  { key: "allocation", label: "Allocation" },
  { key: "dispatch", label: "Dispatch" },
  { key: "delivery", label: "Delivery confirmation" },
];

export interface StepMark {
  by: string;
  on: string; // ISO datetime
}

export interface Candling {
  stage: 1 | 2;
  day: number; // 10 or 18
  date: string; // ISO date
  fertileKept: number;
  removed: number; // infertile / dead removed
  by: string;
  on: string;
}

export type BatchStatus = "active" | "dispatched" | "delivered";

export interface Batch {
  id: string;
  batchNo: string; // human-friendly id
  productType: Product;
  eggSource: string;
  eggCount: number;
  qualityGrade?: string;
  incubator?: string; // setter machine id
  setDate: string; // ISO date
  expectedHatchDate: string; // set + 21
  candling1Date: string; // set + 10
  candling2Date: string; // set + 18
  currentStep: string; // lifecycle step key
  steps: Record<string, StepMark>; // who/when for each completed step
  fertileCount: number; // running fertile-egg count
  hatchedCount: number;
  gradeAcount: number;
  rejectedCount: number; // rejected by vet
  sellableCount: number;
  status: BatchStatus;
  candlings: Candling[];
  history: string[];
  by: string; // who created
  createdAt: string;
}

export interface MachineReading {
  id: string;
  batchId: string;
  machineId: "setter" | "hatcher";
  timestamp: string; // ISO datetime
  temp: number; // °C
  humidity: number; // %
  recordedBy: string;
}

export interface Vaccination {
  id: string;
  batchId: string;
  vaccine: string;
  date: string; // ISO date
  administeredBy: string;
  on: string;
}

export interface LogEntry {
  id: string;
  kind: string; // biosecurity: cleaning/footbath/incident · maintenance: preventive/corrective/downtime
  area?: string; // biosecurity area / equipment
  notes: string;
  downtimeHours?: number; // maintenance only
  staff: string; // acting user
  on: string; // ISO datetime
}

// ---------------------------------------------------------------------------
// Shared with sales
// ---------------------------------------------------------------------------

export interface ChickInventory {
  id: string;
  productType: Product;
  hatchDate: string;
  availableCount: number;
  batchId: string;
  updatedBy: string;
  on: string;
}

export type AllocationStatus =
  | "proposed" // coordination officer matched
  | "finalized" // hatchery manager finalized
  | "approved" // operations manager approved
  | "cancelled";

export interface Allocation {
  id: string;
  orderId: string;
  batchId: string;
  quantity: number;
  productType: Product;
  status: AllocationStatus;
  by: string; // proposed by
  on: string;
  finalizedBy?: string;
  approvedBy?: string;
  history: string[];
}

export interface Dispatch {
  id: string;
  orderId: string;
  batchId: string;
  quantity: number;
  vehicle: string;
  dispatchedAt: string;
  deliveredAt?: string;
  by: string;
}
