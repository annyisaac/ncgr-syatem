/**
 * Logistics module — the operational layer between Hatchery/Sales and Finance.
 *
 * Logistics RECORDS and SUBMITS movement (fleet, trips, deliveries, goods
 * received, expenses); the Accountant VERIFIES and POSTS the financial side.
 * Nothing here touches the ledger directly — that stays with finance.
 *
 * Phase 1: the fleet registers (vehicles + drivers). Later phases add
 * procurement, dispatch, trips, fuel, transfers, returns and expenses.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export const VEHICLE_TYPES = ["Truck", "Van", "Pickup", "Motorcycle", "Refrigerated van", "Car", "Other"] as const;
export const OWNERSHIP_TYPES = ["Company owned", "Hired", "Leased"] as const;
export const FUEL_TYPES = ["Diesel", "Petrol", "Electric", "Hybrid"] as const;

/** A vehicle is available to dispatch only when it says so AND its papers are valid. */
export type VehicleAvailability = "Available" | "On trip" | "Under maintenance" | "Unavailable";

export interface Vehicle {
  id: string;
  plate: string;            // registration number
  type: string;
  ownership: string;
  fuelType: string;
  capacityBoxes?: number;   // how many chick boxes it carries
  assignedDriverId?: string;
  insuranceExpiry?: string; // ISO date
  inspectionExpiry?: string;
  currentMileage?: number;
  availability: VehicleAvailability;
  notes?: string;
  active: boolean;
  by: string;               // email that last saved it
  on: string;               // ISO datetime
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export const LICENCE_CATEGORIES = ["A", "B", "C", "D", "E"] as const;

export interface Driver {
  id: string;
  name: string;
  phone?: string;
  licenceNo?: string;
  licenceCategory?: string;
  licenceExpiry?: string;   // ISO date — an expired licence blocks assignment
  assignedVehicleId?: string;
  emergencyContact?: string;
  employment: "Employee" | "Contractor";
  active: boolean;
  by: string;
  on: string;
}

// ---------------------------------------------------------------------------
// Storage — jsonb-per-row, same shape as every other table
// ---------------------------------------------------------------------------

type LogisticsTable = "vehicles" | "drivers";

async function listRows<T>(table: LogisticsTable): Promise<T[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from(table).select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return (data ?? []).map((r) => r.data as T);
}
async function saveRow(table: LogisticsTable, row: { id: string }): Promise<void> {
  const { error } = await getSupabase().from(table).upsert({ id: row.id, data: row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save ${table}: ${error.message}`);
}

export const listVehicles = () => listRows<Vehicle>("vehicles");
export const upsertVehicle = (v: Vehicle) => saveRow("vehicles", v);
export const listDrivers = () => listRows<Driver>("drivers");
export const upsertDriver = (d: Driver) => saveRow("drivers", d);

export const newVehicleId = () => `veh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export const newDriverId = () => `drv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------
// Expiry / readiness helpers
// ---------------------------------------------------------------------------

/** Days from today to an ISO date; negative when already past. Null if unset. */
export function daysUntil(dateISO: string | undefined, todayISO: string): number | null {
  if (!dateISO) return null;
  return Math.round((Date.parse(dateISO) - Date.parse(todayISO)) / 86_400_000);
}

export type ExpiryState = "ok" | "soon" | "expired" | "unset";
/** A document is "soon" within 30 days, "expired" once past. */
export function expiryState(dateISO: string | undefined, todayISO: string): ExpiryState {
  const d = daysUntil(dateISO, todayISO);
  if (d === null) return "unset";
  if (d < 0) return "expired";
  if (d <= 30) return "soon";
  return "ok";
}

/** A driver may be assigned only with a licence that isn't past its expiry. */
export function driverAssignable(d: Driver, todayISO: string): boolean {
  return d.active && expiryState(d.licenceExpiry, todayISO) !== "expired";
}

/** A vehicle is dispatch-ready when marked Available and neither paper is expired. */
export function vehicleReady(v: Vehicle, todayISO: string): boolean {
  return (
    v.active &&
    v.availability === "Available" &&
    expiryState(v.insuranceExpiry, todayISO) !== "expired" &&
    expiryState(v.inspectionExpiry, todayISO) !== "expired"
  );
}

// ---------------------------------------------------------------------------
// Delivery dispatch — a vehicle+driver trip carrying one or more chick orders
// ---------------------------------------------------------------------------

/** The delivery lifecycle. Kept distinct from the hatchery Dispatch concept. */
export const DELIVERY_STATUSES = [
  "Awaiting Approval", "Ready for Planning", "Scheduled", "Vehicle Assigned",
  "Ready for Loading", "Dispatched", "In Transit", "Partially Delivered",
  "Delivered", "Delivery Failed", "Returned", "Cancelled",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface DispatchStop {
  orderId: string;
  customer: string;
  phone?: string;
  product: string;
  district?: string;
  chicks: number;         // planned to deliver
  boxes?: number;
  batch?: string;
  // Proof of delivery
  delivered?: number;     // accepted quantity
  doa?: number;           // dead on arrival
  damagedBoxes?: number;
  customerComment?: string;
  podRef?: string;        // signed note / photo reference
  gps?: string;
  deliveredAt?: string;   // actual delivery time (ISO)
  outcome?: "pending" | "delivered" | "failed";
  failReason?: string;
}

export interface DeliveryDispatch {
  id: string;
  ref: string;            // DISP-0001
  date: string;           // delivery date
  vehicleId?: string;
  driverId?: string;
  assistant?: string;
  route?: string;
  status: DeliveryStatus;
  stops: DispatchStop[];
  departureTime?: string;
  expectedArrival?: string;
  loadingConfirmed?: boolean;
  officer: string;        // dispatching officer email
  by: string;
  on: string;
  history: string[];
}

export const dispatchChicks = (d: Pick<DeliveryDispatch, "stops">) => d.stops.reduce((s, x) => s + (Number(x.chicks) || 0), 0);
export const dispatchBoxes = (d: Pick<DeliveryDispatch, "stops">) => d.stops.reduce((s, x) => s + (Number(x.boxes) || 0), 0);
export const dispatchDelivered = (d: Pick<DeliveryDispatch, "stops">) => d.stops.reduce((s, x) => s + (Number(x.delivered) || 0), 0);
/** Planned minus accepted across all stops — the discrepancy to reconcile. */
export const dispatchDiscrepancy = (d: Pick<DeliveryDispatch, "stops">) =>
  d.stops.reduce((s, x) => s + Math.max(0, (Number(x.chicks) || 0) - (x.outcome ? (Number(x.delivered) || 0) : (Number(x.chicks) || 0))), 0);

export async function listDispatches(): Promise<DeliveryDispatch[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("delivery_dispatches").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load dispatches: ${error.message}`);
  return (data ?? []).map((r) => r.data as DeliveryDispatch);
}
export async function upsertDispatch(d: DeliveryDispatch): Promise<void> {
  const { error } = await getSupabase().from("delivery_dispatches").upsert({ id: d.id, data: d, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save dispatch: ${error.message}`);
}
export const newDispatchId = () => `disp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** An audit line: "<iso> · <actor> · <action>". */
export function stampAgo(actor: string, action: string): string {
  return `${new Date().toISOString()} · ${actor} · ${action}`;
}

export interface DispatchReadiness { ok: boolean; reasons: string[]; }
/** The dispatch guards: can this trip actually leave? */
export function canDispatch(d: DeliveryDispatch, vehicle: Vehicle | undefined, driver: Driver | undefined, todayISO: string): DispatchReadiness {
  const reasons: string[] = [];
  if (d.stops.length === 0) reasons.push("No orders on this dispatch");
  if (!vehicle) reasons.push("No vehicle assigned");
  else if (!vehicleReady(vehicle, todayISO)) reasons.push("Vehicle is not available or its papers have expired");
  if (!driver) reasons.push("No driver assigned");
  else if (!driverAssignable(driver, todayISO)) reasons.push("Driver licence has expired");
  if (!d.loadingConfirmed) reasons.push("Loading not confirmed");
  return { ok: reasons.length === 0, reasons };
}
