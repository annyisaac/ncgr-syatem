"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  listDispatches, listDrivers, listVehicles, stampAgo, type DeliveryDispatch, type Driver, type Vehicle,
} from "@/lib/logistics";
import {
  COST_ALLOCATIONS, FUEL_STATUSES, TRIP_COST_CATEGORIES, TRIP_PURPOSES,
  costByKey, fuelCostOf, listTrips, newFuelId, newTripId, tripConsumption, tripDistance, tripFuelCost, tripFuelLitres,
  tripMetrics, tripOtherCost, tripTotalCost, upsertTrip,
  type FuelEntry, type Trip, type TripCost, type TripStatus,
} from "@/lib/trips";

const stTone = (s: TripStatus) =>
  s === "Completed" ? "green" : s === "Cancelled" || s === "Vehicle Breakdown" ? "red"
    : s === "Delayed" ? "gold" : s === "Started" || s === "In Progress" ? "info" : "neutral";

export default function TripsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [dispatches, setDispatches] = useState<DeliveryDispatch[]>([]);
  const [editing, setEditing] = useState<Trip | null>(null);

  const canUse = user?.role === "Admin" || user?.role === "Logistics Officer";

  const load = useCallback(async () => {
    try { const [t, v, d, dp] = await Promise.all([listTrips(), listVehicles(), listDrivers(), listDispatches()]); setTrips(t); setVehicles(v); setDrivers(d); setDispatches(dp); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("trips-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["trips", "vehicles", "drivers", "delivery_dispatches"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const vehiclePlate = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles]);
  const dispatchById = useMemo(() => new Map(dispatches.map((d) => [d.id, d])), [dispatches]);

  const done = trips.filter((t) => t.status === "Completed");
  const totalCost = done.reduce((s, t) => s + tripTotalCost(t), 0);
  const totalKm = done.reduce((s, t) => s + tripDistance(t), 0);
  const avgPerKm = totalKm > 0 ? totalCost / totalKm : 0;
  const running = trips.filter((t) => ["Started", "In Progress"].includes(t.status)).length;

  const byVehicle = useMemo(() => costByKey(trips, (t) => vehiclePlate.get(t.vehicleId ?? "") ?? "Unassigned"), [trips, vehiclePlate]);
  const byRoute = useMemo(() => costByKey(trips, (t) => t.route ?? "—"), [trips]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for Logistics and Admin.</p></Card>;

  async function save(t: Trip) {
    setTrips((p) => { const i = p.findIndex((x) => x.id === t.id); const c = p.slice(); if (i === -1) c.unshift(t); else c[i] = t; return c; });
    try { await upsertTrip(t); } catch { toast("Could not save trip.", "error"); void load(); }
  }
  function openNew() {
    setEditing({ id: newTripId(), ref: `TRIP-${String(trips.length + 1).padStart(4, "0")}`, purpose: "Delivery", fuel: [], costs: [], allocation: "Delivery expense", status: "Planned", by: user!.email, on: nowISO(), history: [stampAgo(user!.email, "created")] });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Trips running" value={String(running)} tone={running > 0 ? "gold" : "default"} />
        <StatTile label="Completed" value={String(done.length)} />
        <StatTile label="Transport cost" value={formatRWF(totalCost)} />
        <StatTile label="Avg cost / km" value={avgPerKm ? formatRWF(avgPerKm) : "—"} tone="gold" />
      </div>

      <Card>
        <CardHeader title={`Trips (${trips.length})`} action={<Button size="sm" onClick={openNew}>＋ New trip</Button>} />
        <TableWrap>
          <thead><tr><Th>Ref</Th><Th>Purpose</Th><Th>Vehicle</Th><Th className="text-right">Distance</Th><Th className="text-right">Total cost</Th><Th className="text-right">Cost/km</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {trips.length === 0 ? <EmptyRow colSpan={8} text="No trips yet." /> : trips.map((t) => {
              const km = tripDistance(t); const cost = tripTotalCost(t);
              return (
                <tr key={t.id}>
                  <Td className="font-medium">{t.ref}</Td>
                  <Td>{t.purpose}</Td>
                  <Td>{t.vehicleId ? (vehiclePlate.get(t.vehicleId) ?? "—") : "—"}</Td>
                  <Td className="text-right">{km ? `${km.toLocaleString()} km` : "—"}</Td>
                  <Td className="text-right">{formatRWF(cost)}</Td>
                  <Td className="text-right">{km > 0 ? formatRWF(cost / km) : "—"}</Td>
                  <Td><Pill tone={stTone(t.status)}>{t.status}</Pill></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Open</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Cost by vehicle" />
          <TableWrap>
            <thead><tr><Th>Vehicle</Th><Th className="text-right">Trips</Th><Th className="text-right">Distance</Th><Th className="text-right">Cost</Th><Th className="text-right">Cost/km</Th></tr></thead>
            <tbody>
              {byVehicle.length === 0 ? <EmptyRow colSpan={5} text="No trips yet." /> : byVehicle.map((r) => (
                <tr key={r.key}><Td className="font-medium">{r.key}</Td><Td className="text-right">{r.trips}</Td><Td className="text-right">{r.distance.toLocaleString()} km</Td><Td className="text-right">{formatRWF(r.cost)}</Td><Td className="text-right">{r.costPerKm ? formatRWF(r.costPerKm) : "—"}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
        <Card>
          <CardHeader title="Cost by route" />
          <TableWrap>
            <thead><tr><Th>Route</Th><Th className="text-right">Trips</Th><Th className="text-right">Distance</Th><Th className="text-right">Cost</Th><Th className="text-right">Cost/km</Th></tr></thead>
            <tbody>
              {byRoute.length === 0 ? <EmptyRow colSpan={5} text="No trips yet." /> : byRoute.map((r) => (
                <tr key={r.key}><Td className="font-medium">{r.key}</Td><Td className="text-right">{r.trips}</Td><Td className="text-right">{r.distance.toLocaleString()} km</Td><Td className="text-right">{formatRWF(r.cost)}</Td><Td className="text-right">{r.costPerKm ? formatRWF(r.costPerKm) : "—"}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      {editing && (
        <TripModal key={editing.id} initial={editing} email={user.email} vehicles={vehicles} drivers={drivers} dispatches={dispatches}
          dispatch={editing.dispatchId ? dispatchById.get(editing.dispatchId) : undefined}
          onClose={() => setEditing(null)} onSave={(t) => { void save(t); setEditing(null); toast("Trip saved."); }} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- Trip detail

const NEXT: Partial<Record<TripStatus, TripStatus>> = {
  "Planned": "Approved", "Approved": "Started", "Started": "In Progress", "In Progress": "Completed",
};

function TripModal({ initial, email, vehicles, drivers, dispatches, dispatch, onClose, onSave }: {
  initial: Trip; email: string; vehicles: Vehicle[]; drivers: Driver[]; dispatches: DeliveryDispatch[];
  dispatch: DeliveryDispatch | undefined; onClose: () => void; onSave: (t: Trip) => void;
}) {
  const [t, setT] = useState<Trip>(initial);
  const set = (p: Partial<Trip>) => setT((x) => ({ ...x, ...p }));
  const locked = t.status === "Cancelled" || t.status === "Completed";
  const linkedDispatch = t.dispatchId ? dispatches.find((d) => d.id === t.dispatchId) : dispatch;
  const m = tripMetrics(t, linkedDispatch);
  const consumption = tripConsumption(t);
  const next = NEXT[t.status];

  const setFuel = (i: number, p: Partial<FuelEntry>) => set({ fuel: t.fuel.map((f, j) => j === i ? { ...f, ...p } : f) });
  const setCost = (i: number, p: Partial<TripCost>) => set({ costs: t.costs.map((c, j) => j === i ? { ...c, ...p } : c) });
  const addFuel = () => set({ fuel: [...t.fuel, { id: newFuelId(), date: todayISO(), status: "Requested" }] });
  const addCost = () => set({ costs: [...t.costs, { category: TRIP_COST_CATEGORIES[0], amount: 0 }] });
  const move = (status: TripStatus, action: string) => onSave({ ...t, status, history: [...t.history, stampAgo(email, action)] });

  return (
    <Modal open onClose={onClose} title={`${t.ref} · Trip`} className="max-w-3xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {!locked && <Button variant="secondary" onClick={() => onSave(t)}>Save</Button>}
        {!locked && next && <Button onClick={() => move(next, `→ ${next}`)}>{`Mark ${next}`}</Button>}
        {!locked && <button type="button" onClick={() => move("Cancelled", "cancelled")} className="ml-1 text-xs text-red underline">Cancel trip</button>}
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Pill tone={stTone(t.status)}>{t.status}</Pill></div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Purpose"><Select value={t.purpose} disabled={locked} onChange={(e) => set({ purpose: e.target.value })} options={TRIP_PURPOSES.map((p) => ({ value: p, label: p }))} /></Field>
          <Field label="Vehicle"><Select value={t.vehicleId ?? ""} disabled={locked} onChange={(e) => set({ vehicleId: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...vehicles.filter((v) => v.active).map((v) => ({ value: v.id, label: v.plate }))]} /></Field>
          <Field label="Driver"><Select value={t.driverId ?? ""} disabled={locked} onChange={(e) => set({ driverId: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...drivers.filter((d) => d.active).map((d) => ({ value: d.id, label: d.name }))]} /></Field>
          <Field label="Start location"><Input value={t.startLocation ?? ""} disabled={locked} onChange={(e) => set({ startLocation: e.target.value })} /></Field>
          <Field label="Destination"><Input value={t.destination ?? ""} disabled={locked} onChange={(e) => set({ destination: e.target.value })} /></Field>
          <Field label="Route"><Input value={t.route ?? ""} disabled={locked} onChange={(e) => set({ route: e.target.value })} /></Field>
          <Field label="Depart"><Input value={t.departAt ?? ""} disabled={locked} onChange={(e) => set({ departAt: e.target.value })} placeholder="date/time" /></Field>
          <Field label="Return"><Input value={t.returnAt ?? ""} disabled={locked} onChange={(e) => set({ returnAt: e.target.value })} placeholder="date/time" /></Field>
          <Field label="Linked delivery dispatch"><Select value={t.dispatchId ?? ""} disabled={locked} onChange={(e) => set({ dispatchId: e.target.value || undefined })} options={[{ value: "", label: "None" }, ...dispatches.map((d) => ({ value: d.id, label: `${d.ref} (${d.stops.length} stops)` }))]} /></Field>
          <Field label="Start mileage (km)"><Input type="number" min={0} value={t.startMileage ?? ""} disabled={locked} onChange={(e) => set({ startMileage: Number(e.target.value) || undefined })} /></Field>
          <Field label="End mileage (km)"><Input type="number" min={0} value={t.endMileage ?? ""} disabled={locked} onChange={(e) => set({ endMileage: Number(e.target.value) || undefined })} /></Field>
          <Field label="Transport cost allocation"><Select value={t.allocation} disabled={locked} onChange={(e) => set({ allocation: e.target.value })} options={COST_ALLOCATIONS.map((a) => ({ value: a, label: a }))} /></Field>
        </div>

        {/* Fuel */}
        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Fuel</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[0.6rem] uppercase tracking-wide text-muted"><th className="p-1.5 text-left">Date</th><th className="p-1.5 text-right">Req</th><th className="p-1.5 text-right">Appr</th><th className="p-1.5 text-right">Issued</th><th className="p-1.5 text-right">Price/L</th><th className="p-1.5 text-right">Cost</th><th className="p-1.5">Station</th><th className="p-1.5">Status</th><th></th></tr></thead>
              <tbody>
                {t.fuel.length === 0 ? <tr><td colSpan={9} className="p-2 text-center text-xs text-muted">No fuel recorded.</td></tr> : t.fuel.map((f, i) => (
                  <tr key={f.id} className="border-t border-line">
                    <td className="p-1 w-32"><Input type="date" value={f.date} disabled={locked} onChange={(e) => setFuel(i, { date: e.target.value })} /></td>
                    <td className="p-1 w-16"><Input type="number" min={0} value={f.litresRequested ?? ""} disabled={locked} onChange={(e) => setFuel(i, { litresRequested: Number(e.target.value) || undefined })} /></td>
                    <td className="p-1 w-16"><Input type="number" min={0} value={f.litresApproved ?? ""} disabled={locked} onChange={(e) => setFuel(i, { litresApproved: Number(e.target.value) || undefined, approvedBy: email })} /></td>
                    <td className="p-1 w-16"><Input type="number" min={0} value={f.litresIssued ?? ""} disabled={locked} onChange={(e) => setFuel(i, { litresIssued: Number(e.target.value) || undefined })} /></td>
                    <td className="p-1 w-20"><Input type="number" min={0} value={f.pricePerLitre ?? ""} disabled={locked} onChange={(e) => setFuel(i, { pricePerLitre: Number(e.target.value) || undefined })} /></td>
                    <td className="p-1 text-right">{formatRWF(fuelCostOf(f))}</td>
                    <td className="p-1 w-24"><Input value={f.station ?? ""} disabled={locked} onChange={(e) => setFuel(i, { station: e.target.value })} /></td>
                    <td className="p-1 w-28"><Select value={f.status} disabled={locked} onChange={(e) => setFuel(i, { status: e.target.value as FuelEntry["status"] })} options={FUEL_STATUSES.map((s) => ({ value: s, label: s }))} /></td>
                    <td className="p-1">{!locked && <Button size="sm" variant="ghost" onClick={() => set({ fuel: t.fuel.filter((_, j) => j !== i) })}>✕</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!locked && <Button size="sm" variant="ghost" className="mt-2" onClick={addFuel}>＋ Add fuel</Button>}
          {consumption.l100 > 0 && (
            <p className={`mt-2 text-xs ${consumption.unusual ? "text-red" : "text-muted"}`}>
              Consumption: {consumption.l100} L/100 km{consumption.unusual ? " — unusual, please check the mileage and litres" : ""}.
            </p>
          )}
        </div>

        {/* Other costs */}
        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Other trip costs</div>
          <TableWrap>
            <thead><tr><Th>Category</Th><Th>Note</Th><Th className="text-right">Amount</Th><Th></Th></tr></thead>
            <tbody>
              {t.costs.length === 0 ? <EmptyRow colSpan={4} text="No other costs." /> : t.costs.map((c, i) => (
                <tr key={i}>
                  <Td className="w-52"><Select value={c.category} disabled={locked} onChange={(e) => setCost(i, { category: e.target.value })} options={TRIP_COST_CATEGORIES.map((x) => ({ value: x, label: x }))} /></Td>
                  <Td><Input value={c.note ?? ""} disabled={locked} onChange={(e) => setCost(i, { note: e.target.value })} /></Td>
                  <Td><Input type="number" min={0} value={c.amount || ""} disabled={locked} onChange={(e) => setCost(i, { amount: Number(e.target.value) || 0 })} /></Td>
                  <Td>{!locked && <Button size="sm" variant="ghost" onClick={() => set({ costs: t.costs.filter((_, j) => j !== i) })}>✕</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {!locked && <Button size="sm" variant="ghost" className="mt-2" onClick={addCost}>＋ Add cost</Button>}
        </div>

        {/* Costing summary */}
        <div className="rounded-lg border border-line p-3">
          <div className="mb-2 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Trip costing</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Distance" value={m.distance ? `${m.distance.toLocaleString()} km` : "—"} />
            <StatTile label="Fuel" value={`${tripFuelLitres(t)} L · ${formatRWF(tripFuelCost(t))}`} />
            <StatTile label="Other costs" value={formatRWF(tripOtherCost(t))} />
            <StatTile label="Total cost" value={formatRWF(m.totalCost)} tone="gold" />
            <StatTile label="Cost / km" value={m.costPerKm ? formatRWF(m.costPerKm) : "—"} />
            <StatTile label="Cost / delivery" value={m.costPerDelivery ? formatRWF(m.costPerDelivery) : "—"} />
            <StatTile label="Cost / chick" value={m.costPerChick ? formatRWF(m.costPerChick) : "—"} tone="green" />
            <StatTile label="Cost / box" value={m.costPerBox ? formatRWF(m.costPerBox) : "—"} />
          </div>
          {linkedDispatch ? (
            <p className="mt-2 text-xs text-muted">Per-delivery figures use {linkedDispatch.ref}: {m.deliveries} deliveries, {m.chicks.toLocaleString()} chicks{m.boxes ? `, ${m.boxes} boxes` : ""}.</p>
          ) : <p className="mt-2 text-xs text-muted">Link a delivery dispatch to get cost per delivery, per customer and per chick.</p>}
          <p className="mt-1 text-xs text-muted">Allocated as <strong>{t.allocation}</strong> — Finance posts it accordingly (purchasing trips add to inventory landed cost; delivery trips are a delivery/distribution cost).</p>
        </div>
      </div>
    </Modal>
  );
}
