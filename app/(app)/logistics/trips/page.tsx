"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
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
  const { t: tr } = useLang();
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
  if (!canUse) return <Card><p className="text-sm text-muted">{tr("This page is for Logistics and Admin.")}</p></Card>;

  async function save(t: Trip) {
    setTrips((p) => { const i = p.findIndex((x) => x.id === t.id); const c = p.slice(); if (i === -1) c.unshift(t); else c[i] = t; return c; });
    try { await upsertTrip(t); } catch { toast(tr("Could not save trip."), "error"); void load(); }
  }
  function openNew() {
    setEditing({ id: newTripId(), ref: `TRIP-${String(trips.length + 1).padStart(4, "0")}`, purpose: "Delivery", fuel: [], costs: [], allocation: "Delivery expense", status: "Planned", by: user!.email, on: nowISO(), history: [stampAgo(user!.email, "created")] });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={tr("Trips running")} value={String(running)} tone={running > 0 ? "gold" : "default"} />
        <StatTile label={tr("Completed")} value={String(done.length)} />
        <StatTile label={tr("Transport cost")} value={formatRWF(totalCost)} />
        <StatTile label={tr("Avg cost / km")} value={avgPerKm ? formatRWF(avgPerKm) : "—"} tone="gold" />
      </div>

      <Card>
        <CardHeader title={`${tr("Trips")} (${trips.length})`} action={<Button size="sm" onClick={openNew}>＋ {tr("New trip")}</Button>} />
        <TableWrap>
          <thead><tr><Th>{tr("Ref")}</Th><Th>{tr("Purpose")}</Th><Th>{tr("Vehicle")}</Th><Th className="text-right">{tr("Distance")}</Th><Th className="text-right">{tr("Total cost")}</Th><Th className="text-right">{tr("Cost/km")}</Th><Th>{tr("Status")}</Th><Th></Th></tr></thead>
          <tbody>
            {trips.length === 0 ? <EmptyRow colSpan={8} text={tr("No trips yet.")} /> : trips.map((t) => {
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
                  <Td><Button size="sm" variant="ghost" onClick={() => setEditing(t)}>{tr("Open")}</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={tr("Cost by vehicle")} />
          <TableWrap>
            <thead><tr><Th>{tr("Vehicle")}</Th><Th className="text-right">{tr("Trips")}</Th><Th className="text-right">{tr("Distance")}</Th><Th className="text-right">{tr("Cost")}</Th><Th className="text-right">{tr("Cost/km")}</Th></tr></thead>
            <tbody>
              {byVehicle.length === 0 ? <EmptyRow colSpan={5} text={tr("No trips yet.")} /> : byVehicle.map((r) => (
                <tr key={r.key}><Td className="font-medium">{r.key}</Td><Td className="text-right">{r.trips}</Td><Td className="text-right">{r.distance.toLocaleString()} km</Td><Td className="text-right">{formatRWF(r.cost)}</Td><Td className="text-right">{r.costPerKm ? formatRWF(r.costPerKm) : "—"}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
        <Card>
          <CardHeader title={tr("Cost by route")} />
          <TableWrap>
            <thead><tr><Th>{tr("Route")}</Th><Th className="text-right">{tr("Trips")}</Th><Th className="text-right">{tr("Distance")}</Th><Th className="text-right">{tr("Cost")}</Th><Th className="text-right">{tr("Cost/km")}</Th></tr></thead>
            <tbody>
              {byRoute.length === 0 ? <EmptyRow colSpan={5} text={tr("No trips yet.")} /> : byRoute.map((r) => (
                <tr key={r.key}><Td className="font-medium">{r.key}</Td><Td className="text-right">{r.trips}</Td><Td className="text-right">{r.distance.toLocaleString()} km</Td><Td className="text-right">{formatRWF(r.cost)}</Td><Td className="text-right">{r.costPerKm ? formatRWF(r.costPerKm) : "—"}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      {editing && (
        <TripModal key={editing.id} initial={editing} email={user.email} vehicles={vehicles} drivers={drivers} dispatches={dispatches}
          dispatch={editing.dispatchId ? dispatchById.get(editing.dispatchId) : undefined}
          onClose={() => setEditing(null)} onSave={(t) => { void save(t); setEditing(null); toast(tr("Trip saved.")); }} />
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
  const { t: tr } = useLang();
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
    <Modal open onClose={onClose} title={`${t.ref} · ${tr("Trip")}`} className="max-w-3xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{tr("Close")}</Button>
        {!locked && <Button variant="secondary" onClick={() => onSave(t)}>{tr("Save")}</Button>}
        {!locked && next && <Button onClick={() => move(next, `→ ${next}`)}>{`${tr("Mark")} ${next}`}</Button>}
        {!locked && <button type="button" onClick={() => move("Cancelled", "cancelled")} className="ml-1 text-xs text-red underline">{tr("Cancel trip")}</button>}
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Pill tone={stTone(t.status)}>{t.status}</Pill></div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={tr("Purpose")}><Select value={t.purpose} disabled={locked} onChange={(e) => set({ purpose: e.target.value })} options={TRIP_PURPOSES.map((p) => ({ value: p, label: p }))} /></Field>
          <Field label={tr("Vehicle")}><Select value={t.vehicleId ?? ""} disabled={locked} onChange={(e) => set({ vehicleId: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...vehicles.filter((v) => v.active).map((v) => ({ value: v.id, label: v.plate }))]} /></Field>
          <Field label={tr("Driver")}><Select value={t.driverId ?? ""} disabled={locked} onChange={(e) => set({ driverId: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...drivers.filter((d) => d.active).map((d) => ({ value: d.id, label: d.name }))]} /></Field>
          <Field label={tr("Start location")}><Input value={t.startLocation ?? ""} disabled={locked} onChange={(e) => set({ startLocation: e.target.value })} /></Field>
          <Field label={tr("Destination")}><Input value={t.destination ?? ""} disabled={locked} onChange={(e) => set({ destination: e.target.value })} /></Field>
          <Field label={tr("Route")}><Input value={t.route ?? ""} disabled={locked} onChange={(e) => set({ route: e.target.value })} /></Field>
          <Field label={tr("Depart")}><Input value={t.departAt ?? ""} disabled={locked} onChange={(e) => set({ departAt: e.target.value })} placeholder={tr("date/time")} /></Field>
          <Field label={tr("Return")}><Input value={t.returnAt ?? ""} disabled={locked} onChange={(e) => set({ returnAt: e.target.value })} placeholder={tr("date/time")} /></Field>
          <Field label={tr("Linked delivery dispatch")}><Select value={t.dispatchId ?? ""} disabled={locked} onChange={(e) => set({ dispatchId: e.target.value || undefined })} options={[{ value: "", label: tr("None") }, ...dispatches.map((d) => ({ value: d.id, label: `${d.ref} (${d.stops.length} ${tr("stops")})` }))]} /></Field>
          <Field label={tr("Start mileage (km)")}><Input type="number" min={0} value={t.startMileage ?? ""} disabled={locked} onChange={(e) => set({ startMileage: Number(e.target.value) || undefined })} /></Field>
          <Field label={tr("End mileage (km)")}><Input type="number" min={0} value={t.endMileage ?? ""} disabled={locked} onChange={(e) => set({ endMileage: Number(e.target.value) || undefined })} /></Field>
          <Field label={tr("Transport cost allocation")}><Select value={t.allocation} disabled={locked} onChange={(e) => set({ allocation: e.target.value })} options={COST_ALLOCATIONS.map((a) => ({ value: a, label: a }))} /></Field>
        </div>

        {/* Fuel */}
        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{tr("Fuel")}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[0.6rem] uppercase tracking-wide text-muted"><th className="p-1.5 text-left">{tr("Date")}</th><th className="p-1.5 text-right">{tr("Req")}</th><th className="p-1.5 text-right">{tr("Appr")}</th><th className="p-1.5 text-right">{tr("Issued")}</th><th className="p-1.5 text-right">{tr("Price/L")}</th><th className="p-1.5 text-right">{tr("Cost")}</th><th className="p-1.5">{tr("Station")}</th><th className="p-1.5">{tr("Status")}</th><th></th></tr></thead>
              <tbody>
                {t.fuel.length === 0 ? <tr><td colSpan={9} className="p-2 text-center text-xs text-muted">{tr("No fuel recorded.")}</td></tr> : t.fuel.map((f, i) => (
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
          {!locked && <Button size="sm" variant="ghost" className="mt-2" onClick={addFuel}>＋ {tr("Add fuel")}</Button>}
          {consumption.l100 > 0 && (
            <p className={`mt-2 text-xs ${consumption.unusual ? "text-red" : "text-muted"}`}>
              {tr("Consumption")}: {consumption.l100} L/100 km{consumption.unusual ? ` — ${tr("unusual, please check the mileage and litres")}` : ""}.
            </p>
          )}
        </div>

        {/* Other costs */}
        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{tr("Other trip costs")}</div>
          <TableWrap>
            <thead><tr><Th>{tr("Category")}</Th><Th>{tr("Note")}</Th><Th className="text-right">{tr("Amount")}</Th><Th></Th></tr></thead>
            <tbody>
              {t.costs.length === 0 ? <EmptyRow colSpan={4} text={tr("No other costs.")} /> : t.costs.map((c, i) => (
                <tr key={i}>
                  <Td className="w-52"><Select value={c.category} disabled={locked} onChange={(e) => setCost(i, { category: e.target.value })} options={TRIP_COST_CATEGORIES.map((x) => ({ value: x, label: x }))} /></Td>
                  <Td><Input value={c.note ?? ""} disabled={locked} onChange={(e) => setCost(i, { note: e.target.value })} /></Td>
                  <Td><Input type="number" min={0} value={c.amount || ""} disabled={locked} onChange={(e) => setCost(i, { amount: Number(e.target.value) || 0 })} /></Td>
                  <Td>{!locked && <Button size="sm" variant="ghost" onClick={() => set({ costs: t.costs.filter((_, j) => j !== i) })}>✕</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {!locked && <Button size="sm" variant="ghost" className="mt-2" onClick={addCost}>＋ {tr("Add cost")}</Button>}
        </div>

        {/* Costing summary */}
        <div className="rounded-lg border border-line p-3">
          <div className="mb-2 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{tr("Trip costing")}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={tr("Distance")} value={m.distance ? `${m.distance.toLocaleString()} km` : "—"} />
            <StatTile label={tr("Fuel")} value={`${tripFuelLitres(t)} L · ${formatRWF(tripFuelCost(t))}`} />
            <StatTile label={tr("Other costs")} value={formatRWF(tripOtherCost(t))} />
            <StatTile label={tr("Total cost")} value={formatRWF(m.totalCost)} tone="gold" />
            <StatTile label={tr("Cost / km")} value={m.costPerKm ? formatRWF(m.costPerKm) : "—"} />
            <StatTile label={tr("Cost / delivery")} value={m.costPerDelivery ? formatRWF(m.costPerDelivery) : "—"} />
            <StatTile label={tr("Cost / chick")} value={m.costPerChick ? formatRWF(m.costPerChick) : "—"} tone="green" />
            <StatTile label={tr("Cost / box")} value={m.costPerBox ? formatRWF(m.costPerBox) : "—"} />
          </div>
          {linkedDispatch ? (
            <p className="mt-2 text-xs text-muted">{tr("Per-delivery figures use")} {linkedDispatch.ref}: {m.deliveries} {tr("deliveries")}, {m.chicks.toLocaleString()} {tr("chicks")}{m.boxes ? `, ${m.boxes} ${tr("boxes")}` : ""}.</p>
          ) : <p className="mt-2 text-xs text-muted">{tr("Link a delivery dispatch to get cost per delivery, per customer and per chick.")}</p>}
          <p className="mt-1 text-xs text-muted">{tr("Allocated as")} <strong>{t.allocation}</strong> — {tr("Finance posts it accordingly (purchasing trips add to inventory landed cost; delivery trips are a delivery/distribution cost).")}</p>
        </div>
      </div>
    </Modal>
  );
}
