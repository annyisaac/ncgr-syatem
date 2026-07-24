/**
 * Trips, fuel and transport costing — the cost side of logistics movement.
 *
 * One trip record per collection, delivery or stock transfer. Fuel is issued
 * and its consumption checked against distance; every trip cost (fuel, driver
 * and assistant allowances, hire, tolls, parking, loading, repairs…) rolls up
 * into a total that yields cost per km, per delivery, per customer and per
 * chick. Where a trip serves purchasing, its transport belongs in inventory
 * landed cost; where it serves chick delivery, it's a delivery/distribution
 * cost — the trip records which, for Finance to post.
 */

import { getSupabase } from "./supabase";
import { dispatchDelivered, type DeliveryDispatch } from "./logistics";

const inBrowser = () => typeof window !== "undefined";
const round2 = (n: number) => Math.round(n * 100) / 100;

export const TRIP_PURPOSES = ["Delivery", "Collection", "Stock transfer", "Other"] as const;
export const TRIP_STATUSES = ["Planned", "Approved", "Started", "In Progress", "Completed", "Cancelled", "Delayed", "Vehicle Breakdown"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const COST_ALLOCATIONS = [
  "Delivery expense", "Customer delivery charge", "Cost of sales", "Distribution overhead", "Inventory landed cost",
] as const;

/** Trip cost categories beyond fuel (fuel is derived from the fuel entries). */
export const TRIP_COST_CATEGORIES = [
  "Driver allowance", "Assistant allowance", "Vehicle hire", "Road tolls", "Parking",
  "Loading", "Offloading", "Repairs during trip", "Accommodation", "Other",
] as const;

export const FUEL_STATUSES = ["Requested", "Approved", "Issued", "Confirmed"] as const;
export type FuelStatus = (typeof FUEL_STATUSES)[number];

export interface FuelEntry {
  id: string;
  date: string;
  fuelType?: string;
  litresRequested?: number;
  litresApproved?: number;
  litresIssued?: number;
  pricePerLitre?: number;
  station?: string;
  receiptRef?: string;
  odometer?: number;
  status: FuelStatus;
  approvedBy?: string;
}
export const fuelCostOf = (f: FuelEntry) => round2((Number(f.litresIssued) || 0) * (Number(f.pricePerLitre) || 0));

export interface TripCost { category: string; amount: number; note?: string; }

export interface Trip {
  id: string;
  ref: string;            // TRIP-0001
  purpose: string;
  startLocation?: string;
  destination?: string;
  route?: string;
  vehicleId?: string;
  driverId?: string;
  dispatchId?: string;    // links a delivery dispatch (for per-chick metrics)
  departAt?: string;
  returnAt?: string;
  startMileage?: number;
  endMileage?: number;
  fuel: FuelEntry[];
  costs: TripCost[];
  allocation: string;     // one of COST_ALLOCATIONS
  status: TripStatus;
  by: string;
  on: string;
  history: string[];
}

// ---- Derived metrics ------------------------------------------------------

export const tripDistance = (t: Pick<Trip, "startMileage" | "endMileage">) =>
  Math.max(0, (Number(t.endMileage) || 0) - (Number(t.startMileage) || 0));
export const tripFuelLitres = (t: Pick<Trip, "fuel">) => round2(t.fuel.reduce((s, f) => s + (Number(f.litresIssued) || 0), 0));
export const tripFuelCost = (t: Pick<Trip, "fuel">) => round2(t.fuel.reduce((s, f) => s + fuelCostOf(f), 0));
export const tripOtherCost = (t: Pick<Trip, "costs">) => round2(t.costs.reduce((s, c) => s + (Number(c.amount) || 0), 0));
export const tripTotalCost = (t: Pick<Trip, "fuel" | "costs">) => round2(tripFuelCost(t) + tripOtherCost(t));
/** Litres per 100 km — flagged as unusual outside 5–35 for a road vehicle. */
export function tripConsumption(t: Trip): { l100: number; unusual: boolean } {
  const d = tripDistance(t); const l = tripFuelLitres(t);
  if (d <= 0 || l <= 0) return { l100: 0, unusual: false };
  const l100 = round2((l / d) * 100);
  return { l100, unusual: l100 < 5 || l100 > 35 };
}

export interface TripMetrics {
  distance: number; fuelLitres: number; fuelCost: number; otherCost: number; totalCost: number;
  costPerKm: number; deliveries: number; chicks: number; boxes: number;
  costPerDelivery: number; costPerChick: number; costPerBox: number;
}
export function tripMetrics(t: Trip, dispatch: DeliveryDispatch | undefined): TripMetrics {
  const distance = tripDistance(t);
  const totalCost = tripTotalCost(t);
  const stops = dispatch?.stops ?? [];
  const deliveries = stops.filter((s) => s.outcome === "delivered").length || stops.length;
  const chicks = dispatch ? dispatchDelivered(dispatch) : 0;
  const boxes = stops.reduce((s, x) => s + (Number(x.boxes) || 0), 0);
  const per = (n: number) => (n > 0 ? round2(totalCost / n) : 0);
  return {
    distance, fuelLitres: tripFuelLitres(t), fuelCost: tripFuelCost(t), otherCost: tripOtherCost(t), totalCost,
    costPerKm: per(distance), deliveries, chicks, boxes,
    costPerDelivery: per(deliveries), costPerChick: per(chicks), costPerBox: per(boxes),
  };
}

// ---- Rollups (cost by vehicle / route) ------------------------------------

export interface CostRollup { key: string; trips: number; distance: number; cost: number; costPerKm: number; }
export function costByKey(trips: Trip[], keyOf: (t: Trip) => string): CostRollup[] {
  const m = new Map<string, { trips: number; distance: number; cost: number }>();
  for (const t of trips) {
    if (t.status === "Cancelled") continue;
    const k = keyOf(t) || "—";
    const g = m.get(k) ?? { trips: 0, distance: 0, cost: 0 };
    g.trips += 1; g.distance += tripDistance(t); g.cost += tripTotalCost(t);
    m.set(k, g);
  }
  return [...m.entries()].map(([key, g]) => ({ key, ...g, costPerKm: g.distance > 0 ? round2(g.cost / g.distance) : 0 }))
    .sort((a, b) => b.cost - a.cost);
}

// ---- Storage --------------------------------------------------------------

export async function listTrips(): Promise<Trip[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("trips").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load trips: ${error.message}`);
  return (data ?? []).map((r) => r.data as Trip);
}
export async function upsertTrip(t: Trip): Promise<void> {
  const { error } = await getSupabase().from("trips").upsert({ id: t.id, data: t, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save trip: ${error.message}`);
}
export const newTripId = () => `trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export const newFuelId = () => `fuel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
