"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { visibleOrders } from "@/lib/permissions";
import { COMPANY, formatRWF } from "@/lib/config";
import { ensureDriverLink, listDeliveryLinks } from "@/lib/db";
import { nowISO, formatDate } from "@/lib/format";
import { canAllocate, fulfillOrder, rescheduleOrder, withHistory } from "@/lib/orders";
import { deliveryPaymentPDF } from "@/lib/reports";
import { balance, paidAmount, toDeliver, type Order, type Route } from "@/lib/types";

const CAN_EDIT = ["Admin", "Tetra Zone Manager", "Ross Order Receiver"];
const deliverChicks = (o: Order) => o.deliveryChicks ?? toDeliver(o);
const isActive = (o: Order) => o.status !== "refunded" && o.status !== "rejected";
const stopStatus = (o: Order) => (o.deliverOk ? "Delivered" : o.deliveryFail ? "Not delivered" : "Pending");

// ---- reports --------------------------------------------------------------

function csvCell(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
function esc(s: string) { return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }

function downloadCsv(route: Route, dateLabel: string, orders: Order[]) {
  const rows: string[][] = [
    ["Delivery report"], ["Route", route.name], ["Driver", route.driver], ["Date", dateLabel], [],
    ["#", "Customer", "Phone", "Sector", "District", "Pickup", "Chicks", "Product", "Status"],
  ];
  let total = 0;
  orders.forEach((o, i) => { const c = deliverChicks(o); total += c; rows.push([String(i + 1), o.name, o.phone, o.sector, o.district, o.pickupLocation ?? "", String(c), o.product, stopStatus(o)]); });
  rows.push([], ["TOTAL CHICKS", "", "", "", "", "", String(total)]);
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${route.name.replace(/\s+/g, "-")}-${dateLabel}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function printManifest(route: Route, dateLabel: string, orders: Order[]) {
  const total = orders.reduce((s, o) => s + deliverChicks(o), 0);
  const rows = orders.map((o, i) => `<tr><td>${i + 1}</td><td>${esc(o.name)}</td><td>${esc(o.phone)}</td><td>${esc(o.sector)}</td><td>${esc(o.district)}</td><td style="text-align:right">${deliverChicks(o).toLocaleString()}</td><td>${esc(stopStatus(o))}</td><td class="sig"></td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(route.name)} — ${dateLabel}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#20201c;padding:24px}h1{margin:0 0 2px;font-size:20px}.muted{color:#6e6656;font-size:13px}
    .meta{margin:10px 0 16px;font-size:14px}.meta b{color:#20201c}table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border:1px solid #d9d2c2;padding:6px 8px;text-align:left}th{background:#f6f3ea}.sig{width:120px}tfoot td{font-weight:bold;background:#faf7ef}@media print{button{display:none}}
  </style></head><body>
    <h1>${esc(COMPANY.name)} — Delivery Manifest</h1><div class="muted">${esc(COMPANY.address)}</div>
    <div class="meta">Route: <b>${esc(route.name)}</b> &nbsp;·&nbsp; Driver: <b>${esc(route.driver)}</b> &nbsp;·&nbsp; Date: <b>${dateLabel}</b> &nbsp;·&nbsp; Stops: <b>${orders.length}</b></div>
    <table><thead><tr><th>#</th><th>Customer</th><th>Phone</th><th>Sector</th><th>District</th><th style="text-align:right">Chicks</th><th>Status</th><th>Received (sign)</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:#6e6656">No stops</td></tr>`}</tbody>
    <tfoot><tr><td colspan="5">TOTAL CHICKS</td><td style="text-align:right">${total.toLocaleString()}</td><td></td><td></td></tr></tfoot></table>
    <p class="muted" style="margin-top:20px">Driver signature: ____________________  Date: __________</p>
    <button onclick="window.print()" style="margin-top:16px;padding:8px 14px">Print</button></body></html>`;
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
}

// ---------------------------------------------------------------------------

export default function DayPlanPage() {
  const params = useParams<{ date: string }>();
  const activeDate = params.date;
  const { user } = useAuth();
  const { orders, routes, upsertRoute, removeRoute, upsertOrder, newId } = useData();
  const { toast } = useToast();

  const [rName, setRName] = useState("");
  const [rDriver, setRDriver] = useState("");
  const [rCap, setRCap] = useState("");
  const [rErr, setRErr] = useState<string | null>(null);
  const [allocFor, setAllocFor] = useState<Order | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<Order | null>(null);
  const [driverLinks, setDriverLinks] = useState<Record<string, string>>({});

  // Show each driver's existing link on load, so it stays visible for the whole
  // delivery — it doesn't vanish once stops are delivered or after a refresh.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const links = await listDeliveryLinks();
        if (!active) return;
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const map: Record<string, string> = {};
        for (const l of links) if (l.active) map[l.driver] = `${origin}/deliver/${l.token}`;
        setDriverLinks(map);
      } catch {
        /* links stay hidden until generated manually */
      }
    })();
    return () => { active = false; };
  }, []);

  const role = user?.role;
  const canEdit = !!role && CAN_EDIT.includes(role);
  const scoped = useMemo(() => (user ? visibleOrders(orders, user) : []), [orders, user]);

  // Keep delivered orders on the day's plan (marked delivered) so the manifest
  // can be reprinted any time — they no longer drop off once delivered.
  const dayOrders = useMemo(
    () =>
      scoped
        .filter((o) => o.date === activeDate && o.confirmedOk && isActive(o))
        .sort((a, b) => a.plan - b.plan), // rescheduled-in orders carry a lower plan → shown first
    [scoped, activeDate]
  );
  const routeIds = useMemo(() => new Set(routes.map((r) => r.id)), [routes]);
  // "Ready to allocate" excludes already-delivered stops.
  const ready = useMemo(
    () => dayOrders.filter((o) => !o.deliverOk && (!o.routeId || !routeIds.has(o.routeId))),
    [dayOrders, routeIds]
  );
  const dayTotal = dayOrders.reduce((s, o) => s + deliverChicks(o), 0);
  const deliveredCount = dayOrders.filter((o) => o.deliverOk).length;
  const advancePaid = dayOrders.reduce((s, o) => s + paidAmount(o), 0);
  const toCollect = dayOrders.reduce((s, o) => s + Math.max(0, balance(o)), 0);
  const routeOrders = (routeId: string) => dayOrders.filter((o) => o.routeId === routeId);
  const dateLabel = formatDate(activeDate);

  if (!user) return null;

  function createRoute(e: React.FormEvent) {
    e.preventDefault();
    setRErr(null);
    if (!rName.trim()) return setRErr("Enter a route name.");
    if (!rDriver.trim()) return setRErr("Enter the delivery driver.");
    const r: Route = { id: newId("route"), name: rName.trim(), driver: rDriver.trim(), capacity: Number(rCap) || undefined, by: user!.email, on: nowISO() };
    upsertRoute(r);
    toast(`Route ${r.name} created.`);
    setRName(""); setRDriver(""); setRCap("");
  }

  function deleteRoute(route: Route) {
    if (!confirm(`Delete route “${route.name}”? Its orders will be un-assigned.`)) return;
    scoped.filter((o) => o.routeId === route.id).forEach((o) => upsertOrder({ ...o, routeId: undefined, deliveryChicks: undefined, pickupLocation: undefined }));
    // Explicit single-row delete — sending the whole list would delete routes
    // another planner created since this tab loaded.
    void removeRoute(route.id);
    toast(`Route ${route.name} deleted.`);
  }

  function allocate(o: Order, chicks: number, pickup: string, routeId: string) {
    const block = canAllocate(o);
    if (block) { setAllocFor(null); return toast(block, "info"); }
    upsertOrder({ ...o, routeId, deliveryChicks: chicks, pickupLocation: pickup });
    toast(`${o.name} allocated to ${routes.find((r) => r.id === routeId)?.name ?? "route"}.`);
    setAllocFor(null);
  }

  function unallocate(o: Order) {
    upsertOrder({ ...o, routeId: undefined, deliveryChicks: undefined, pickupLocation: undefined });
    toast(`${o.name} removed from its route.`);
  }

  function markDelivered(o: Order) {
    const routeName = routes.find((r) => r.id === o.routeId)?.name ?? "route";
    upsertOrder(fulfillOrder(o, user!, `Delivered on ${routeName}`));
    toast(`${o.name} marked delivered.`);
  }

  async function makeDriverLink(driver: string) {
    if (!driver.trim()) return toast("This route has no driver name.", "info");
    try {
      const token = await ensureDriverLink(driver.trim(), user!.email);
      const url = `${window.location.origin}/deliver/${token}`;
      setDriverLinks((m) => ({ ...m, [driver]: url }));
      try {
        await navigator.clipboard.writeText(url);
        toast(`Driver link copied — send it to ${driver}.`);
      } catch {
        toast(`Driver link ready for ${driver}.`);
      }
    } catch {
      toast("Could not create the driver link.", "info");
    }
  }

  function reschedule(o: Order, newDate: string) {
    // Move to the new day (placed first there). If it was already on a route,
    // pull it off — the truck for the old day no longer carries it.
    const wasOn = o.routeId ? routes.find((r) => r.id === o.routeId)?.name : undefined;
    let next = rescheduleOrder(o, newDate, user!, orders);
    if (wasOn) next = withHistory(next, user!, `Removed from route ${wasOn} (rescheduled)`);
    upsertOrder({ ...next, routeId: undefined, deliveryChicks: undefined, pickupLocation: undefined });
    toast(
      wasOn
        ? `${o.name} rescheduled to ${formatDate(newDate)} — taken off ${wasOn}, placed first for that day.`
        : `${o.name} rescheduled to ${formatDate(newDate)} — placed first for that day.`
    );
    setRescheduleFor(null);
  }

  return (
    <div className="space-y-5">
      <Link href="/planning" className="text-sm text-gold-dark underline">← Back to calendar</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted">
            {dayTotal.toLocaleString()} chicks · {dayOrders.length} stop(s)
            {deliveredCount > 0 && <span className="text-green"> · {deliveredCount} delivered</span>}
          </p>
        </div>
        <Pill tone={canEdit ? "gold" : "neutral"}>{canEdit ? "Full access" : "View only"}</Pill>
      </div>

      {/* Collections — the day's money view (folded in from the old Deliveries page) */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHeader title="Collections for this day" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              dayOrders.length
                ? deliveryPaymentPDF(dayOrders.slice().sort((a, b) => a.plan - b.plan), dateLabel)
                : toast("No orders to export for this day.", "info")
            }
          >
            Download payment sheet (PDF)
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Chicks to deliver" value={dayTotal.toLocaleString()} />
          <Stat label="Orders" value={String(dayOrders.length)} />
          <Stat label="Advance paid" value={formatRWF(advancePaid)} tone="green" />
          <Stat label="Balance to collect" value={formatRWF(toCollect)} tone="red" />
        </div>
      </Card>

      {/* Routes */}
      <Card>
        <CardHeader title={`Routes (${routes.length})`} />
        {canEdit && (
          <form onSubmit={createRoute} className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="Route name"><Input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="e.g. Kigali East" /></Field>
            <Field label="Delivery driver"><Input value={rDriver} onChange={(e) => setRDriver(e.target.value)} placeholder="Driver name" /></Field>
            <Field label="Capacity (chicks, optional)"><Input type="number" value={rCap} onChange={(e) => setRCap(e.target.value)} placeholder="e.g. 5000" /></Field>
            <Button type="submit">Add route</Button>
            {rErr && <p className="w-full text-sm text-status-refunded">{rErr}</p>}
          </form>
        )}
        {routes.length === 0 && <p className="text-sm text-muted">No routes yet.{canEdit ? " Create one above." : ""}</p>}
      </Card>

      {/* Ready to allocate */}
      <Card>
        <CardHeader title={`Ready to deliver — allocate to a route (${ready.length})`} />
        <TableWrap>
          <thead><tr><Th>Customer</Th><Th>Product</Th><Th>District</Th><Th>Sector</Th><Th className="text-right">Chicks</Th><Th>Action</Th></tr></thead>
          <tbody>
            {ready.length === 0 ? <EmptyRow colSpan={6} text="Nothing waiting to be allocated for this day." /> : ready.map((o) => {
              const allocBlock = canAllocate(o);
              return (
              <tr key={o.id}>
                <Td className="font-medium">
                  {o.name} <span className="text-xs text-muted">· {o.phone}</span>
                  {o.debtOk && <span className="ml-2 align-middle"><Pill tone="info">On debt</Pill></span>}
                </Td>
                <Td>{o.product}</Td>
                <Td>{o.district}</Td>
                <Td>{o.sector}</Td>
                <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                <Td>
                  {canEdit ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-1">
                        <Button size="sm" disabled={!!allocBlock} title={allocBlock ?? undefined} onClick={() => setAllocFor(o)}>Allocate</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRescheduleFor(o)}>Reschedule</Button>
                      </div>
                      {allocBlock && <span className="text-[11px] text-status-refunded">Payment not verified — can’t allocate</span>}
                    </div>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </Td>
              </tr>
            );})}
          </tbody>
        </TableWrap>
      </Card>

      {/* Route cards */}
      {routes.map((route) => {
        const list = routeOrders(route.id);
        const total = list.reduce((s, o) => s + deliverChicks(o), 0);
        const over = route.capacity ? total > route.capacity : false;
        const delivered = list.filter((o) => o.deliverOk).length;
        return (
          <Card key={route.id}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="card-title">{route.name}</h3>
                <p className="text-sm text-muted">
                  Driver: <strong className="text-ink">{route.driver}</strong> · {list.length} stop(s) · <strong className="text-ink">{total.toLocaleString()}</strong> chicks
                  {route.capacity ? ` / ${route.capacity.toLocaleString()} capacity` : ""}
                  {delivered > 0 && <span className="text-green"> · {delivered}/{list.length} delivered</span>}
                  {over && <span className="ml-2"><Pill tone="red">Over capacity</Pill></span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => printManifest(route, dateLabel, list)} disabled={list.length === 0}>Print manifest</Button>
                <Button variant="ghost" size="sm" onClick={() => downloadCsv(route, dateLabel, list)} disabled={list.length === 0}>CSV</Button>
                {canEdit && <Button variant="ghost" size="sm" onClick={() => makeDriverLink(route.driver)}>Driver link</Button>}
                {canEdit && <Button variant="ghost" size="sm" onClick={() => deleteRoute(route)}>Delete</Button>}
              </div>
            </div>
            {driverLinks[route.driver] && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#efdfae] bg-gold-bg px-3 py-2 text-xs">
                <span className="shrink-0 font-semibold text-ink">Driver link for {route.driver}:</span>
                <input readOnly value={driverLinks[route.driver]} onFocus={(e) => e.currentTarget.select()} className="min-w-0 grow bg-transparent text-gold-dark outline-none" />
                <button type="button" onClick={() => makeDriverLink(route.driver)} className="shrink-0 font-semibold text-gold-dark underline">Copy</button>
              </div>
            )}
            <TableWrap>
              <thead><tr><Th>Customer</Th><Th>Phone</Th><Th>Pickup</Th><Th>Sector</Th><Th className="text-right">Chicks</Th>{canEdit && <Th></Th>}</tr></thead>
              <tbody>
                {list.length === 0 ? <EmptyRow colSpan={canEdit ? 6 : 5} text="No stops on this route for this day." /> : list.map((o) => (
                  <tr key={o.id} className={o.deliverOk ? "bg-green-bg" : undefined}>
                    <Td className="font-medium">
                      {o.name}
                      {o.deliverOk && (
                        <span className="ml-2 align-middle"><Pill tone="green">Delivered ✓</Pill></span>
                      )}
                      {o.deliveryFail && !o.deliverOk && (
                        <span className="ml-2 align-middle"><Pill tone="red">Not delivered</Pill></span>
                      )}
                      {o.deliveryFail && !o.deliverOk && <div className="text-xs font-normal text-muted">{o.deliveryFail.reason}</div>}
                    </Td>
                    <Td>{o.phone}</Td>
                    <Td>{o.pickupLocation ?? "—"}</Td>
                    <Td>{o.sector}</Td>
                    <Td className="text-right">{deliverChicks(o).toLocaleString()}</Td>
                    {canEdit && (
                      <Td>
                        {o.deliverOk ? (
                          <span className="text-xs font-medium text-green">Delivered</span>
                        ) : (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => markDelivered(o)}>Delivered</Button>
                            <Button size="sm" variant="ghost" onClick={() => setRescheduleFor(o)}>Reschedule</Button>
                            <Button size="sm" variant="ghost" onClick={() => unallocate(o)}>Remove</Button>
                          </div>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        );
      })}

      {allocFor && (
        <AllocateModal order={allocFor} routes={routes} onClose={() => setAllocFor(null)} onSave={(chicks, pickup, routeId) => allocate(allocFor, chicks, pickup, routeId)} />
      )}

      {rescheduleFor && (
        <RescheduleModal
          order={rescheduleFor}
          routeName={rescheduleFor.routeId ? routes.find((r) => r.id === rescheduleFor.routeId)?.name : undefined}
          onClose={() => setRescheduleFor(null)}
          onSave={(date) => reschedule(rescheduleFor, date)}
        />
      )}
    </div>
  );
}

function RescheduleModal({ order, routeName, onClose, onSave }: {
  order: Order; routeName?: string; onClose: () => void; onSave: (date: string) => void;
}) {
  const [date, setDate] = useState(order.date);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Reschedule — ${order.name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => {
          if (!date) return setErr("Choose a new delivery date.");
          if (date === order.date) return setErr("Pick a different date.");
          onSave(date);
        }}>Save new date</Button>
      </>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">Currently {formatDate(order.date)}. The order will be placed <strong className="text-ink">first</strong> in the new day&apos;s delivery plan.</p>
        {routeName && (
          <div className="rounded-xl border border-[#efdfae] bg-gold-bg px-3 py-2.5 text-ink">
            This order is on route <strong>{routeName}</strong>. Rescheduling will <strong>take it off that route</strong> — you&apos;ll re-allocate it on the new day.
          </div>
        )}
        <Field label="New delivery date"><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setErr(null); }} /></Field>
        {err && <p className="text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? "text-green" : tone === "red" ? "text-red" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-cream/40 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function AllocateModal({ order, routes, onClose, onSave }: {
  order: Order; routes: Route[]; onClose: () => void; onSave: (chicks: number, pickup: string, routeId: string) => void;
}) {
  const [chicks, setChicks] = useState(String(toDeliver(order)));
  const [pickup, setPickup] = useState("Hatchery");
  const [routeId, setRouteId] = useState(routes[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Allocate — ${order.name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => {
          const n = Number(chicks) || 0;
          if (routes.length === 0) return setErr("Create a route first.");
          if (!routeId) return setErr("Choose a route.");
          if (n <= 0) return setErr("Enter the chicks to deliver.");
          if (!pickup.trim()) return setErr("Enter the pickup location.");
          onSave(n, pickup.trim(), routeId);
        }}>Allocate</Button>
      </>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">{order.product} · {order.district} · to deliver {toDeliver(order).toLocaleString()} chicks</p>
        <Field label="Chicks to deliver"><Input type="number" min={1} value={chicks} onChange={(e) => setChicks(e.target.value)} /></Field>
        <Field label="Pickup location"><Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="Where the chicks are picked up" /></Field>
        <Field label="Route">
          {routes.length === 0 ? <p className="text-status-refunded">No routes yet — create one on the page first.</p> : (
            <Select value={routeId} onChange={(e) => setRouteId(e.target.value)} options={routes.map((r) => ({ value: r.id, label: `${r.name} — ${r.driver}` }))} />
          )}
        </Field>
        {err && <p className="text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}
