/**
 * Hatchery domain types — modelled on the real NCGR process.
 * Storage convention matches the sales side: { id, data, updated_at } jsonb rows.
 * Every record carries the acting user + timestamp for traceability.
 */

import type { Product } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHICKS_PER_BOX = 102;
export const MAX_MACHINE_TEMP_F = 120;
export const INCUBATION_DAYS = 21;
export const CANDLING_1_DAY = 10;
export const CANDLING_2_DAY = 18;

/** Trailing batch-code segment: 01 = Ross 308, 02 = Tetra Super Harco. */
export const PRODUCT_CODE: Record<Product, "01" | "02"> = {
  "Ross 308": "01",
  "Tetra Super Harco": "02",
};
export function productFromCode(code: string): Product {
  return code === "01" ? "Ross 308" : "Tetra Super Harco";
}

export interface StepMark {
  by: string;
  on: string;
}

/** Lifecycle steps in order (the real NCGR flow). */
export const LIFECYCLE_STEPS: { key: string; label: string }[] = [
  { key: "reception", label: "Egg reception" },
  { key: "storage", label: "Store room" },
  { key: "fumigation", label: "Fumigation" },
  { key: "setting", label: "Setting" },
  { key: "candling-1", label: "Candling I" },
  { key: "candling-2", label: "Candling II" },
  { key: "transfer", label: "Transfer to hatcher" },
  { key: "hatching", label: "Hatching" },
  { key: "counting", label: "Counting & boxing" },
  { key: "vaccination", label: "Vaccination" },
  { key: "dispatch", label: "Dispatch" },
  { key: "delivery", label: "Delivery" },
];

// ---------------------------------------------------------------------------
// Breeder farms & flocks — maintained by Admin / Hatchery Manager; selected
// (not typed) by Production Technicians at egg reception.
// ---------------------------------------------------------------------------

export interface Farm {
  id: string;
  name: string;
  location?: string;
  active: boolean;
  by: string;
  on: string;
}

export interface Flock {
  id: string;
  code: string; // the flock ID, e.g. "NCGR-F25-R03-03"
  farmId: string;
  productType: Product; // breed this flock lays for
  active: boolean;
  by: string;
  on: string;
}

// ---------------------------------------------------------------------------
// Egg reception
// ---------------------------------------------------------------------------

/** Where a reception currently sits after intake. */
export type ReceptionLocation = "store" | "ready";

export interface Reception {
  id: string;
  date: string; // ISO date received
  farm: string;
  flockId: string;
  ageOfFlock: number; // weeks
  eggsReceived: number;
  ageOfEggs: number; // days
  crackedOnFarm: number;
  crackedOnSet: number;
  misshapen: number;
  dirty: number;
  productType: Product;
  location?: ReceptionLocation; // chosen after intake: egg store room, or ready to set
  fumigatedEggs?: number; // running total fumigated across trolleys
  by: string;
  on: string;
  batchId?: string; // set once combined into a batch
}

/** Store-room temperature/humidity reading while eggs wait. */
export interface StoreReading {
  id: string;
  timestamp: string;
  temp: number; // °F
  humidity: number; // %
  recordedBy: string;
}

/** One trolley loaded for a fumigation run. */
export interface TrolleyRow {
  label: string; // trolley number / name
  eggs: number;
}

export interface Fumigation {
  id: string;
  date: string;
  receptionId?: string; // which reception was fumigated
  farm?: string;
  flockId?: string;
  chemicals: string;
  trolleys: TrolleyRow[];
  totalEggs: number; // sum of trolley eggs
  time: string; // clock time / duration
  by: string;
  on: string;
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

export type MachineType = "setter" | "hatcher";

export interface Machine {
  id: string;
  code: string; // S01 / H01
  type: MachineType;
  capacity: number; // eggs
  active: boolean;
  by: string;
  on: string;
}

/**
 * A named hatchery operator. All attendants share one login, so the manager
 * registers each person and the system issues a unique code they enter to
 * prove who recorded a reading.
 */
export interface Operator {
  id: string;
  name: string;
  code: string; // unique short code, system-generated
  active: boolean;
  by: string;
  on: string;
}

/** Eggs placed into a specific machine (setter or hatcher). */
export interface MachineAssignment {
  machineCode: string;
  eggs: number;
}

export interface MachineReading {
  id: string;
  machineCode: string;
  batchId?: string;
  timestamp: string;
  fanSpeed: number;
  dryF: number;
  wetF: number;
  digitalTempF: number;
  digitalHumidityF: number;
  /** Egg-turning direction at this reading; alternates each turn. */
  turning?: TurnDirection;
  operator: string; // operator name (verified by code)
  operatorCode?: string; // the code the operator entered to prove identity
  comment?: string;
  recordedBy: string;
}

export type TurnDirection = "left" | "right";

// ---------------------------------------------------------------------------
// Candling
// ---------------------------------------------------------------------------

export const CANDLING_1_CATEGORIES = [
  { key: "infertile", label: "Infertile" },
  { key: "earlyDead", label: "Early dead" },
  { key: "bloodring", label: "Bloodring" },
  { key: "contaminated", label: "Contaminated" },
  { key: "cracked", label: "Cracked" },
  { key: "others", label: "Others" },
];
export const CANDLING_2_CATEGORIES = [
  { key: "midDead", label: "Mid dead" },
  { key: "contaminated", label: "Contaminated" },
  { key: "cracked", label: "Cracked" },
  { key: "others", label: "Others" },
];

export interface Candling {
  stage: 1 | 2;
  date: string;
  categories: Record<string, number>; // removals by category
  totalRemoved: number;
  by: string;
  on: string;
}

/**
 * One flock inside a batch. A batch (the product) can hold several flocks;
 * candling and transfer are done flock-by-flock, while vaccination/hatch/
 * counting stay at the batch (product) level.
 */
export interface BatchFlock {
  flockId: string;
  farm: string;
  ageOfFlock: number; // weeks
  receptionIds: string[];
  eggsSet: number; // eggs from this flock set in the batch
  candlings: Candling[]; // stage 1 & 2 for this flock
  transfers: MachineAssignment[]; // this flock's fertile eggs to hatcher(s)
}

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

// "inactive" = every chick delivered and inventory drained to zero; the batch
// is closed and drops out of active lists.
export type BatchStatus = "active" | "dispatched" | "delivered" | "inactive";

export interface Batch {
  id: string;
  batchNo: string; // NCGR-H26-W29-02
  productType: Product;
  farm: string;
  flockId: string;
  receptionIds: string[]; // combined daily receptions
  eggsSet: number; // total eggs set (sum across flocks)
  flocks?: BatchFlock[]; // per-flock breakdown (multi-flock batches)
  setters: MachineAssignment[];
  transfers: MachineAssignment[]; // batch-level total (recomputed from flocks)
  candlings: Candling[]; // batch-level total (recomputed from flocks)
  hatchedCount: number;
  culls: number;
  unhatchedCount: number;
  saleableCount: number; // hatched - culls
  countedTotal: number; // from box-by-box counting
  vaccinated: boolean;
  currentStep: string;
  status: BatchStatus;
  steps: Record<string, StepMark>;
  history: string[];
  by: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Counting & boxes
// ---------------------------------------------------------------------------

/**
 * A Hatchery Attendant's box-by-box count of one FLOCK's hatched chicks.
 * They count saleable chicks per box, then the total culls. A Production
 * Technician verifies it before it becomes the flock's hatch result.
 */
export interface ChickCount {
  id: string;
  batchId: string;
  flockId?: string; // which flock in the batch (per-flock counting)
  boxes: number[]; // saleable chicks counted in each box
  total: number; // saleable total (sum of boxes)
  culls?: number; // culls counted (total)
  by: string;
  on: string;
  verified?: boolean; // Production Technician verified the count
  verifiedBy?: string;
  verifiedOn?: string;
  vaxCulls?: number; // culls removed during vaccination → final saleable = total − vaxCulls
}

/** Daily boxes assembled from bought unassembled stock. */
export interface BoxLog {
  id: string;
  date: string;
  boxesMade: number;
  by: string;
  on: string;
}

// ---------------------------------------------------------------------------
// Supplies inventory (unassembled boxes + vaccines)
// ---------------------------------------------------------------------------

// Inventory categories kept in the general store. "box" and "vaccine" are the
// original two (consumed by box-making + vaccination); the rest are purchased
// consumables. Hatched chicks are NOT a Supply — they are read live from
// chick_inventory as a read-only category on the Inventory page.
export type SupplyKind =
  | "box"
  | "vaccine"
  | "staff-food"
  | "dog-food"
  | "hygiene";

export const SUPPLY_CATEGORIES: { value: SupplyKind; label: string; unit: string }[] = [
  { value: "vaccine", label: "Vaccines", unit: "doses" },
  { value: "box", label: "Unassembled boxes", unit: "boxes" },
  { value: "staff-food", label: "Food (hatchery staff)", unit: "kg" },
  { value: "dog-food", label: "Food (dogs)", unit: "kg" },
  { value: "hygiene", label: "Hygiene materials", unit: "units" },
];

/** One purchase / stock-in: how much was bought, at what price, from whom. */
export interface Purchase {
  qty: number;
  unitCost: number; // RWF per unit
  supplier: string;
  on: string;
  by: string;
}

export interface Supply {
  id: string;
  kind: SupplyKind;
  name: string;
  unit: string; // e.g. "boxes", "doses"
  quantity: number; // current stock
  purchases?: Purchase[]; // buy log (qty + cost + supplier)
  history: string[];
  by: string;
  on: string;
}

// ---------------------------------------------------------------------------
// Spare parts store — recorded by the Hatchery Manager, who approves each
// withdrawal request before a part leaves the room.
// ---------------------------------------------------------------------------

export interface SparePart {
  id: string;
  name: string;
  unit: string; // e.g. "pcs"
  quantity: number; // in the spare-part room
  location?: string;
  purchases?: Purchase[];
  history: string[];
  by: string;
  on: string;
}

export type SparePartRequestStatus = "pending" | "approved" | "rejected";

export interface SparePartRequest {
  id: string;
  partId: string;
  partName: string; // snapshot at request time
  quantity: number;
  reason: string;
  requestedBy: string; // email
  requestedByName: string;
  status: SparePartRequestStatus;
  decidedBy?: string;
  decidedOn?: string;
  note?: string;
  on: string;
}

// ---------------------------------------------------------------------------
// Vaccination
// ---------------------------------------------------------------------------

export interface Vaccination {
  id: string;
  batchId: string;
  vaccine: string; // supply name
  doses: number;
  date: string;
  administeredBy: string;
  on: string;
}

// ---------------------------------------------------------------------------
// Shared with sales + logs
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

export type AllocationStatus = "proposed" | "finalized" | "approved" | "cancelled";

export interface Allocation {
  id: string;
  orderId: string;
  batchId: string;
  quantity: number;
  productType: Product;
  status: AllocationStatus;
  by: string;
  on: string;
  finalizedBy?: string;
  approvedBy?: string;
  history: string[];
}

export interface Dispatch {
  id: string;
  orderId?: string;
  batchId: string;
  quantity: number;
  pickupLocation: string;
  carrier: string; // vehicle or person
  carrierType: "vehicle" | "person";
  dispatchedAt: string;
  deliveredAt?: string;
  by: string;
}

export interface LogEntry {
  id: string;
  kind: string;
  area?: string;
  notes: string;
  downtimeHours?: number;
  staff: string;
  on: string;
}

// ---------------------------------------------------------------------------
// Veterinary — farm visits & vaccine requests
// ---------------------------------------------------------------------------

/**
 * A vet's farm visit to a customer to collect flock health data. If the deaths
 * were caused by a hatchery problem, the report is forwarded to sales so the
 * customer can be compensated.
 */
export interface FarmVisit {
  id: string;
  date: string;
  customerName: string;
  product: Product; // routes compensation to the Ross / Tetra salesperson
  chicksBought: number;
  mortality7Day: number; // deaths within 7 days
  mortalityAfter7Day: number; // deaths after 7 days
  cause: string; // investigated cause of death
  problem: string;
  solution: string; // suggested solution
  hatcheryCaused: boolean; // deaths due to a hatchery problem → compensation
  sentToSales: boolean; // report forwarded to sales
  by: string; // vet
  on: string;
  history: string[];
}

export type VaccineRequestStatus = "requested" | "confirmed" | "sent" | "declined";

/**
 * Vet requests a vaccine to be bought → Operations Manager confirms →
 * Hatchery Manager receives it and adds it to inventory.
 */
export interface VaccineRequest {
  id: string;
  date: string;
  vaccine: string;
  quantity: number;
  unit: string; // e.g. "doses"
  reason?: string;
  status: VaccineRequestStatus;
  requestedBy: string; // vet
  confirmedBy?: string; // operations manager
  sentBy?: string; // hatchery manager
  by: string;
  on: string;
  history: string[];
}
