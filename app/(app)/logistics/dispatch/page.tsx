"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useLang } from "@/components/LanguageProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { fulfillOrder, shortDeliver } from "@/lib/orders";
import { toDeliver, type Order } from "@/lib/types";
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  canDispatch, dispatchBoxes, dispatchChicks, dispatchDelivered, dispatchDiscrepancy,
  driverAssignable, listDispatches, listDrivers, listVehicles, newDispatchId, stampAgo, upsertDispatch, vehicleReady,
  type DeliveryDispatch, type DeliveryStatus, type DispatchStop, type Driver, type Vehicle,
} from "@/lib/logistics";

const isClosed = (o: Order) => o.status === "refunded" || o.status === "rejected";
const isDelivered = (o: Order) => o.deliverOk || o.status === "fulfilled";
/** Confirmed or debt-approved orders that still need delivering. */
const readyForDelivery = (o: Order) => !isClosed(o) && !isDelivered(o) && (o.confirmedOk || o.debtOk);

const stTone = (s: DeliveryStatus) =>
  s === "Delivered" ? "green" : s === "Delivery Failed" || s === "Cancelled" ? "red"
    : s === "Partially Delivered" || s === "Returned" ? "gold"
    : s === "Dispatched" || s === "In Transit" ? "info" : "neutral";

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function DispatchPage() {
  const { user } = useAuth();
  const { orders, upsertOrder, newId } = useData();
  const { toast } = useToast();
  const { t } = useLang();
  const [dispatches, setDispatches] = useState<DeliveryDispatch[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [editing, setEditing] = useState<DeliveryDispatch | null>(null);
  const [picking, setPicking] = useState(false);

  const canUse = user?.role === "Admin" || user?.role === "Logistics Officer";

  const load = useCallback(async () => {
    try { const [d, v, dr] = await Promise.all([listDispatches(), listVehicles(), listDrivers()]); setDispatches(d); setVehicles(v); setDrivers(dr); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("dispatch-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["delivery_dispatches", "vehicles", "drivers"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const today = todayISO();
  // Orders already placed on a dispatch that isn't cancelled — don't offer them twice.
  const dispatchedOrderIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of dispatches) if (d.status !== "Cancelled") for (const st of d.stops) s.add(st.orderId);
    return s;
  }, [dispatches]);
  const queue = useMemo(() => orders.filter((o) => readyForDelivery(o) && !dispatchedOrderIds.has(o.id)), [orders, dispatchedOrderIds]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">{t("This page is for Logistics and Admin.")}</p></Card>;

  async function save(d: DeliveryDispatch) {
    setDispatches((p) => { const i = p.findIndex((x) => x.id === d.id); const c = p.slice(); if (i === -1) c.unshift(d); else c[i] = d; return c; });
    try { await upsertDispatch(d); } catch { toast(t("Could not save dispatch."), "error"); void load(); }
  }

  /** Write each stop's proof of delivery back to its order. */
  function reconcile(d: DeliveryDispatch) {
    for (const st of d.stops) {
      const o = orders.find((x) => x.id === st.orderId);
      if (!o || isDelivered(o) || isClosed(o)) continue;
      const accepted = Number(st.delivered) || 0;
      if (st.outcome === "delivered" && accepted > 0) {
        // Never record a delivery before the hatchery has allocated the chicks.
        if (!o.allocatedOk) { toast(`${o.name}: not allocated at the hatchery yet — delivery not recorded.`, "info"); continue; }
        if (accepted >= o.chicks) { upsertOrder(fulfillOrder(o, user!, `Delivered on ${d.ref}`)); }
        else { const { order, backorder } = shortDeliver(o, accepted, addDays(d.date, 7), user!, orders, newId); upsertOrder(order); upsertOrder(backorder); }
      } else if (st.outcome === "failed") {
        upsertOrder({ ...o, deliveryFail: { reason: st.failReason || "Delivery failed", on: nowISO(), by: user!.email }, history: [...o.history, `${nowISO()} · ${user!.email} · delivery failed on ${d.ref}${st.failReason ? ` — ${st.failReason}` : ""}`] });
      }
    }
  }

  const active = dispatches.filter((d) => !["Delivered", "Cancelled"].includes(d.status));
  const inTransit = dispatches.filter((d) => d.status === "Dispatched" || d.status === "In Transit").length;
  const awaitingPod = dispatches.filter((d) => (d.status === "Dispatched" || d.status === "In Transit") && d.stops.some((s) => !s.outcome)).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("In the queue")} value={String(queue.length)} />
        <StatTile label={t("Open dispatches")} value={String(active.length)} />
        <StatTile label={t("In transit")} value={String(inTransit)} tone={inTransit > 0 ? "gold" : "default"} />
        <StatTile label={t("Awaiting proof")} value={String(awaitingPod)} tone={awaitingPod > 0 ? "gold" : "default"} />
      </div>

      <Card>
        <CardHeader title={`${t("Dispatches")} (${dispatches.length})`} action={<Button size="sm" onClick={() => setPicking(true)} disabled={queue.length === 0}>{`＋ ${t("New dispatch")}`}</Button>} />
        <TableWrap>
          <thead><tr><Th>{t("Ref")}</Th><Th>{t("Date")}</Th><Th>{t("Vehicle · Driver")}</Th><Th className="text-right">{t("Stops")}</Th><Th className="text-right">{t("Chicks")}</Th><Th>{t("Status")}</Th><Th></Th></tr></thead>
          <tbody>
            {dispatches.length === 0 ? <EmptyRow colSpan={7} text={t("No dispatches yet — create one from the delivery queue.")} /> : dispatches.map((d) => {
              const veh = vehicles.find((v) => v.id === d.vehicleId); const dr = drivers.find((x) => x.id === d.driverId);
              return (
                <tr key={d.id}>
                  <Td className="font-medium">{d.ref}</Td>
                  <Td>{formatDate(d.date)}</Td>
                  <Td>{veh?.plate ?? "—"}{dr ? ` · ${dr.name}` : ""}</Td>
                  <Td className="text-right">{d.stops.length}</Td>
                  <Td className="text-right">{dispatchChicks(d).toLocaleString()}</Td>
                  <Td><Pill tone={stTone(d.status)}>{d.status}</Pill></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setEditing(d)}>{t("Open")}</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {picking && (
        <QueueModal queue={queue} onClose={() => setPicking(false)}
          onCreate={(ids) => {
            const chosen = queue.filter((o) => ids.has(o.id));
            const date = chosen[0]?.date ?? today;
            const stops: DispatchStop[] = chosen.map((o) => ({ orderId: o.id, customer: o.name, phone: o.phone, product: o.product, district: o.district, chicks: toDeliver(o), outcome: "pending" }));
            const ref = `DISP-${String(dispatches.length + 1).padStart(4, "0")}`;
            const d: DeliveryDispatch = { id: newDispatchId(), ref, date, status: "Ready for Planning", stops, officer: user.email, by: user.email, on: nowISO(), history: [stampAgo(user.email, "created")] };
            void save(d); setPicking(false); setEditing(d);
            toast(`${t("Created")} ${ref} ${t("with")} ${stops.length} ${t("stop(s).")}`);
          }} />
      )}

      {editing && (
        <DispatchModal key={editing.id} initial={editing} email={user.email} vehicles={vehicles} drivers={drivers} today={today}
          onClose={() => setEditing(null)}
          onSave={(d) => { void save(d); setEditing(null); toast(t("Dispatch saved.")); }}
          onReconcile={(d) => { reconcile(d); void save(d); setEditing(null); toast(t("Proof of delivery applied to orders.")); }} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- Queue picker

function QueueModal({ queue, onClose, onCreate }: { queue: Order[]; onClose: () => void; onCreate: (ids: Set<string>) => void }) {
  const { t } = useLang();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const byDate = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of queue) { const g = m.get(o.date) ?? []; g.push(o); m.set(o.date, g); }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [queue]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleDate = (list: Order[]) => setSel((s) => { const n = new Set(s); const all = list.every((o) => n.has(o.id)); list.forEach((o) => all ? n.delete(o.id) : n.add(o.id)); return n; });

  return (
    <Modal open onClose={onClose} title={t("Delivery queue — choose orders")} className="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button><Button onClick={() => onCreate(sel)} disabled={sel.size === 0}>{`${t("Create dispatch")} (${sel.size})`}</Button></>}>
      <p className="mb-3 text-xs text-muted">{t("Confirmed and debt-approved orders awaiting delivery, grouped by delivery date. Group one date onto one vehicle.")}</p>
      <div className="space-y-4">
        {byDate.length === 0 ? <p className="text-sm text-muted">{t("Nothing waiting for delivery.")}</p> : byDate.map(([date, list]) => (
          <div key={date}>
            <button type="button" onClick={() => toggleDate(list)} className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-gold-dark underline">{formatDate(date)} · {list.length} {t("order(s)")}</button>
            <TableWrap>
              <thead><tr><Th></Th><Th>{t("Customer")}</Th><Th>{t("Product")}</Th><Th className="text-right">{t("Chicks")}</Th><Th>{t("District")}</Th></tr></thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id} className={sel.has(o.id) ? "bg-gold-bg/40" : ""}>
                    <Td><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></Td>
                    <Td className="font-medium">{o.name}<div className="text-xs text-muted">{o.phone}</div></Td>
                    <Td>{o.product}</Td>
                    <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                    <Td>{o.district}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------- Dispatch detail

const NEXT: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  "Ready for Planning": "Scheduled",
  "Scheduled": "Vehicle Assigned",
  "Vehicle Assigned": "Ready for Loading",
  "Ready for Loading": "Dispatched",
  "Dispatched": "In Transit",
};

function DispatchModal({ initial, email, vehicles, drivers, today, onClose, onSave, onReconcile }: {
  initial: DeliveryDispatch; email: string; vehicles: Vehicle[]; drivers: Driver[]; today: string;
  onClose: () => void; onSave: (d: DeliveryDispatch) => void; onReconcile: (d: DeliveryDispatch) => void;
}) {
  const { t } = useLang();
  const [d, setD] = useState<DeliveryDispatch>(initial);
  const set = (p: Partial<DeliveryDispatch>) => setD((x) => ({ ...x, ...p }));
  const setStop = (i: number, p: Partial<DispatchStop>) => set({ stops: d.stops.map((s, j) => j === i ? { ...s, ...p } : s) });

  const veh = vehicles.find((v) => v.id === d.vehicleId);
  const dr = drivers.find((x) => x.id === d.driverId);
  const readiness = canDispatch(d, veh, dr, today);
  const locked = d.status === "Delivered" || d.status === "Cancelled";
  const inField = d.status === "Dispatched" || d.status === "In Transit";
  const allResolved = d.stops.every((s) => s.outcome && s.outcome !== "pending");

  function move(status: DeliveryStatus, action: string) {
    onSave({ ...d, status, history: [...d.history, stampAgo(email, action)] });
  }
  function dispatch() {
    if (!readiness.ok) return;
    onSave({ ...d, status: "Dispatched", departureTime: d.departureTime || nowISO(), history: [...d.history, stampAgo(email, "dispatched")] });
  }
  function complete() {
    const anyDelivered = d.stops.some((s) => s.outcome === "delivered");
    const allFailed = d.stops.every((s) => s.outcome === "failed");
    const status: DeliveryStatus = allFailed ? "Delivery Failed" : d.stops.every((s) => s.outcome === "delivered") ? "Delivered" : anyDelivered ? "Partially Delivered" : d.status;
    onReconcile({ ...d, status, history: [...d.history, stampAgo(email, `completed — ${status}`)] });
  }

  const next = NEXT[d.status];

  return (
    <Modal open onClose={onClose} title={`${d.ref} · ${t("Delivery dispatch")}`} className="max-w-3xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Close")}</Button>
        {!locked && <Button variant="secondary" onClick={() => onSave(d)}>{t("Save")}</Button>}
        {!locked && !inField && next && next !== "Dispatched" && <Button onClick={() => move(next, `→ ${next}`)}>{`${t("Mark")} ${next}`}</Button>}
        {!locked && d.status === "Ready for Loading" && <Button onClick={dispatch} disabled={!readiness.ok}>{t("Dispatch")}</Button>}
        {inField && <Button onClick={complete} disabled={!allResolved}>{t("Complete & reconcile")}</Button>}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={stTone(d.status)}>{d.status}</Pill>
          <span className="text-xs text-muted">{d.stops.length} {t("stop(s)")} · {dispatchChicks(d).toLocaleString()} {t("chicks")}{dispatchBoxes(d) ? ` · ${dispatchBoxes(d)} ${t("boxes")}` : ""}</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("Delivery date")}><Input type="date" value={d.date} disabled={locked} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label={t("Vehicle")}><Select value={d.vehicleId ?? ""} disabled={locked || inField} onChange={(e) => set({ vehicleId: e.target.value || undefined })} options={[{ value: "", label: t("Assign vehicle") }, ...vehicles.filter((v) => v.active).map((v) => ({ value: v.id, label: `${v.plate}${vehicleReady(v, today) ? "" : ` ${t("(unavailable)")}`}` }))]} /></Field>
          <Field label={t("Driver")}><Select value={d.driverId ?? ""} disabled={locked || inField} onChange={(e) => set({ driverId: e.target.value || undefined })} options={[{ value: "", label: t("Assign driver") }, ...drivers.filter((x) => x.active).map((x) => ({ value: x.id, label: `${x.name}${driverAssignable(x, today) ? "" : ` ${t("(licence expired)")}`}` }))]} /></Field>
          <Field label={t("Assistant")}><Input value={d.assistant ?? ""} disabled={locked} onChange={(e) => set({ assistant: e.target.value })} /></Field>
          <Field label={t("Route")}><Input value={d.route ?? ""} disabled={locked} onChange={(e) => set({ route: e.target.value })} placeholder={t("e.g. Rwamagana loop")} /></Field>
          <Field label={t("Expected arrival")}><Input value={d.expectedArrival ?? ""} disabled={locked} onChange={(e) => set({ expectedArrival: e.target.value })} placeholder={t("e.g. 11:00")} /></Field>
        </div>

        {!locked && !inField && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={!!d.loadingConfirmed} onChange={(e) => set({ loadingConfirmed: e.target.checked })} /> {t("Chicks loaded and counted (loading confirmed)")}
          </label>
        )}

        {d.status === "Ready for Loading" && !readiness.ok && (
          <div className="rounded-lg border border-red/30 bg-red-bg/40 p-3 text-sm">
            <strong>{t("Can't dispatch yet:")}</strong>
            <ul className="mt-1 list-disc pl-5 text-xs">{readiness.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        )}

        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">
            {inField ? t("Stops — record proof of delivery") : t("Stops")}
          </div>
          <div className="space-y-2">
            {d.stops.map((s, i) => (
              <div key={s.orderId} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">{s.customer} <span className="text-muted">· {s.product} · {s.chicks.toLocaleString()} {t("chicks")} · {s.district}</span></div>
                  {s.outcome && s.outcome !== "pending" && <Pill tone={s.outcome === "delivered" ? "green" : "red"}>{s.outcome}</Pill>}
                </div>
                {!inField && !locked && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label={t("Boxes")}><Input type="number" min={0} value={s.boxes ?? ""} onChange={(e) => setStop(i, { boxes: Number(e.target.value) || undefined })} /></Field>
                    <Field label={t("Hatch batch")}><Input value={s.batch ?? ""} onChange={(e) => setStop(i, { batch: e.target.value })} /></Field>
                  </div>
                )}
                {inField && (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Field label={t("Delivered / accepted")}><Input type="number" min={0} value={s.delivered ?? ""} onChange={(e) => setStop(i, { delivered: Number(e.target.value) || 0 })} /></Field>
                      <Field label={t("Dead on arrival")}><Input type="number" min={0} value={s.doa ?? ""} onChange={(e) => setStop(i, { doa: Number(e.target.value) || undefined })} /></Field>
                      <Field label={t("Damaged boxes")}><Input type="number" min={0} value={s.damagedBoxes ?? ""} onChange={(e) => setStop(i, { damagedBoxes: Number(e.target.value) || undefined })} /></Field>
                      <Field label={t("POD ref (signed/photo)")}><Input value={s.podRef ?? ""} onChange={(e) => setStop(i, { podRef: e.target.value })} /></Field>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Field label={t("Customer comment")}><Input value={s.customerComment ?? ""} onChange={(e) => setStop(i, { customerComment: e.target.value })} /></Field>
                      <Field label={t("GPS")}><Input value={s.gps ?? ""} onChange={(e) => setStop(i, { gps: e.target.value })} placeholder={t("lat, lng")} /></Field>
                      <Field label={t("Outcome")}><Select value={s.outcome ?? "pending"} onChange={(e) => setStop(i, { outcome: e.target.value as DispatchStop["outcome"], deliveredAt: nowISO() })} options={[{ value: "pending", label: t("Pending") }, { value: "delivered", label: t("Delivered") }, { value: "failed", label: t("Failed") }]} /></Field>
                    </div>
                    {s.outcome === "failed" && <Field label={t("Failure reason")}><Input value={s.failReason ?? ""} onChange={(e) => setStop(i, { failReason: e.target.value })} /></Field>}
                    {s.outcome === "delivered" && (Number(s.delivered) || 0) < s.chicks && <p className="text-xs text-red">{t("Discrepancy:")} {(s.chicks - (Number(s.delivered) || 0)).toLocaleString()} {t("short — a backorder will be created.")}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {inField && (
          <div className="rounded-lg border border-line p-3 text-sm">
            <div className="flex items-center gap-2 font-semibold">{t("Reconciliation")} <Pill tone={dispatchDiscrepancy(d) > 0 ? "gold" : "green"}>{dispatchDiscrepancy(d) > 0 ? `${dispatchDiscrepancy(d)} ${t("short")}` : t("balanced")}</Pill></div>
            <div className="mt-1 text-xs text-muted">{t("Dispatched")} {dispatchChicks(d).toLocaleString()} · {t("delivered")} {dispatchDelivered(d).toLocaleString()}{t(". Completing writes each stop back to its order (full delivery, short-delivery backorder, or a failed-delivery flag).")}</div>
          </div>
        )}

        {!locked && d.status !== "Cancelled" && <button type="button" onClick={() => move("Cancelled", "cancelled")} className="text-xs text-red underline">{t("Cancel this dispatch")}</button>}
      </div>
    </Modal>
  );
}
