"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { cn } from "@/lib/cn";
import { visibleOrders } from "@/lib/permissions";
import { formatRWF } from "@/lib/config";
import { ensureRouteLink, getDeliveryProof, listDeliveryLinks, type DeliveryProof } from "@/lib/db";
import { nowISO, formatDate } from "@/lib/format";
import { canAllocate, fulfillOrder, rescheduleOrder, splitOrder, withHistory } from "@/lib/orders";
import { deliveryPaymentPDF, manifestPDF } from "@/lib/reports";
import { listDrivers, listVehicles, type Driver, type Vehicle } from "@/lib/logistics";
import { allVerified, balance, paidAmount, toDeliver, type Order, type Route } from "@/lib/types";

const CAN_EDIT = ["Admin", "Tetra Zone Manager", "Ross Order Receiver", "Tetra Payment Checker", "Ross Payment Checker"];
const deliverChicks = (o: Order) => o.deliveryChicks ?? toDeliver(o);
const isActive = (o: Order) => o.status !== "refunded" && o.status !== "rejected";
const stopStatus = (o: Order) => (o.deliverOk ? "Delivered" : o.deliveryFail ? "Not delivered" : "Pending");
const paymentCleared = (o: Order) => !!o.debtOk || allVerified(o);

type Tone = "gold" | "green" | "blue" | "purple" | "red" | "amber" | "ink";
const TONE_BG: Record<Tone, string> = {
  gold: "bg-gold-bg text-gold-dark",
  green: "bg-green-bg text-green",
  blue: "bg-blue-bg text-blue",
  purple: "bg-[#efe7fb] text-[#7c3aed]",
  red: "bg-red-bg text-red",
  amber: "bg-amber-bg text-amber",
  ink: "bg-grey-bg text-ink",
};

// ---- contact / map deep-links (no external API — plain links) --------------
const digits = (p?: string) => (p ?? "").replace(/\D/g, "");
function waHref(phone?: string): string {
  const d = digits(phone);
  const intl = d.startsWith("250") ? d : d.startsWith("0") ? `250${d.slice(1)}` : `250${d}`;
  return `https://wa.me/${intl}`;
}
function mapHref(o: Order): string {
  const q = [o.sector, o.district, "Rwanda"].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// ---- reports --------------------------------------------------------------

function csvCell(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

function downloadCsv(route: Route, dateLabel: string, orders: Order[]) {
  const rows: string[][] = [
    ["Delivery report"], ["Route", route.name], ["Driver", route.driver], ["Vehicle", route.vehicle ?? ""], ["Date", dateLabel], [],
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

// ---------------------------------------------------------------------------

export default function DayPlanPage() {
  const params = useParams<{ date: string }>();
  const activeDate = params.date;
  const { user } = useAuth();
  const { orders, routes, dsrs, upsertRoute, removeRoute, upsertOrder, newId } = useData();
  const { toast } = useToast();

  const [rName, setRName] = useState("");
  const [rDriver, setRDriver] = useState("");
  const [rVehicle, setRVehicle] = useState("");
  const [rCap, setRCap] = useState("");
  const [rErr, setRErr] = useState<string | null>(null);
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [allocFor, setAllocFor] = useState<Order | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<Order | null>(null);
  const [splitFor, setSplitFor] = useState<Order | null>(null);
  const [qrFor, setQrFor] = useState<{ url: string; driver: string } | null>(null);
  const [editRoute, setEditRoute] = useState<Route | null>(null);
  const [proofView, setProofView] = useState<{ order: Order; proof: DeliveryProof | null; loading: boolean } | null>(null);
  const [driverLinks, setDriverLinks] = useState<Record<string, string>>({});
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [links, dr, ve] = await Promise.all([listDeliveryLinks(), listDrivers(), listVehicles()]);
        if (!active) return;
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const map: Record<string, string> = {};
        for (const l of links) if (l.active && l.routeId) map[l.routeId] = `${origin}/deliver/${l.token}`;
        setDriverLinks(map);
        setDrivers(dr.filter((d) => d.active));
        setVehicles(ve.filter((v) => v.active));
      } catch {
        /* links/fleet stay hidden until available */
      }
    })();
    return () => { active = false; };
  }, []);

  // Fleet autocomplete suggestions for the route driver / vehicle fields.
  const driverNames = useMemo(() => [...new Set(drivers.map((d) => d.name).filter(Boolean))].sort(), [drivers]);
  const vehiclePlates = useMemo(() => [...new Set(vehicles.map((v) => v.plate).filter(Boolean))].sort(), [vehicles]);

  const role = user?.role;
  const canEdit = !!role && CAN_EDIT.includes(role);
  const scoped = useMemo(() => (user ? visibleOrders(orders, user) : []), [orders, user]);

  const dayOrders = useMemo(
    () =>
      scoped
        .filter((o) => o.date === activeDate && o.confirmedOk && isActive(o))
        .sort((a, b) => a.plan - b.plan),
    [scoped, activeDate]
  );
  // Routes for THIS delivery date. Older routes with no date stay visible on
  // every day so existing allocations keep showing.
  const dayRoutes = useMemo(
    () => routes.filter((r) => !r.date || r.date === activeDate),
    [routes, activeDate]
  );
  const routeIds = useMemo(() => new Set(dayRoutes.map((r) => r.id)), [dayRoutes]);
  const ready = useMemo(
    () => dayOrders.filter((o) => !o.deliverOk && (!o.routeId || !routeIds.has(o.routeId))),
    [dayOrders, routeIds]
  );

  // KPI aggregates for the day.
  const kpi = useMemo(() => {
    const total = dayOrders.length;
    const planned = dayOrders.filter((o) => o.routeId && routeIds.has(o.routeId)).length;
    const delivered = dayOrders.filter((o) => o.deliverOk).length;
    const failed = dayOrders.filter((o) => o.deliveryFail && !o.deliverOk).length;
    const chicks = dayOrders.reduce((s, o) => s + deliverChicks(o), 0);
    const allocatedChicks = dayOrders.filter((o) => o.allocatedOk).reduce((s, o) => s + deliverChicks(o), 0);
    const advancePaid = dayOrders.reduce((s, o) => s + paidAmount(o), 0);
    const balanceToCollect = dayOrders.reduce((s, o) => s + Math.max(0, balance(o)), 0);
    const deliveredSet = dayOrders.filter((o) => o.deliverOk);
    const collected = deliveredSet.reduce((s, o) => s + paidAmount(o), 0);
    const outstanding = deliveredSet.reduce((s, o) => s + Math.max(0, balance(o)), 0);
    const activeRoutes = dayRoutes.filter((r) => dayOrders.some((o) => o.routeId === r.id));
    return {
      total, planned, delivered, failed, awaiting: ready.length,
      chicks, allocatedChicks, remainingChicks: Math.max(0, chicks - allocatedChicks),
      allocPct: chicks ? Math.round((allocatedChicks / chicks) * 100) : 0,
      advancePaid, balanceToCollect, collected, outstanding,
      routes: dayRoutes.length,
      activeRoutes: activeRoutes.length,
      drivers: new Set(activeRoutes.map((r) => r.driver).filter(Boolean)).size,
      vehicles: new Set(activeRoutes.map((r) => r.vehicle).filter(Boolean)).size,
    };
  }, [dayOrders, ready, dayRoutes, routeIds]);

  // Day pipeline (cumulative funnel).
  const flow = useMemo(() => {
    const total = dayOrders.length;
    return [
      { key: "confirmed", label: "Confirmed", count: total, tone: "gold" as Tone },
      { key: "cleared", label: "Payment cleared", count: dayOrders.filter(paymentCleared).length, tone: "blue" as Tone },
      { key: "planned", label: "Planned", count: kpi.planned, tone: "blue" as Tone },
      { key: "allocated", label: "Chicks allocated", count: dayOrders.filter((o) => o.allocatedOk).length, tone: "purple" as Tone },
      { key: "delivered", label: "Delivered", count: kpi.delivered, tone: "green" as Tone },
    ];
  }, [dayOrders, kpi.planned, kpi.delivered]);

  const routeOrders = (routeId: string) => dayOrders.filter((o) => o.routeId === routeId);
  const dateLabel = formatDate(activeDate);

  // District breakdown for the day's analytics.
  const byDistrict = useMemo(() => {
    const m = new Map<string, { stops: number; chicks: number; delivered: number }>();
    for (const o of dayOrders) {
      const g = m.get(o.district || "—") ?? { stops: 0, chicks: 0, delivered: 0 };
      g.stops += 1; g.chicks += deliverChicks(o); if (o.deliverOk) g.delivered += 1;
      m.set(o.district || "—", g);
    }
    return [...m.entries()].sort((a, b) => b[1].chicks - a[1].chicks);
  }, [dayOrders]);

  // Collections expected per route, and the day's failed deliveries.
  const byRoute = useMemo(() =>
    dayRoutes
      .map((r) => {
        const list = dayOrders.filter((o) => o.routeId === r.id);
        if (list.length === 0) return null;
        return {
          r,
          stops: list.length,
          chicks: list.reduce((s, o) => s + deliverChicks(o), 0),
          advance: list.reduce((s, o) => s + paidAmount(o), 0),
          expected: list.reduce((s, o) => s + Math.max(0, balance(o)), 0),
          delivered: list.filter((o) => o.deliverOk).length,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x),
    [dayRoutes, dayOrders]
  );
  const failedList = useMemo(() => dayOrders.filter((o) => o.deliveryFail && !o.deliverOk), [dayOrders]);

  if (!user) return null;

  function createRoute(e: React.FormEvent) {
    e.preventDefault();
    setRErr(null);
    if (!rName.trim()) return setRErr("Enter a route name.");
    if (!rDriver.trim()) return setRErr("Enter the delivery driver.");
    const r: Route = { id: newId("route"), name: rName.trim(), driver: rDriver.trim(), vehicle: rVehicle.trim() || undefined, capacity: Number(rCap) || undefined, date: activeDate, by: user!.email, on: nowISO() };
    upsertRoute(r);
    toast(`Route ${r.name} created.`);
    setRName(""); setRDriver(""); setRVehicle(""); setRCap(""); setShowRouteForm(false);
  }

  function saveRouteEdit(patch: { name: string; driver: string; vehicle: string; capacity: string }) {
    if (!editRoute) return;
    upsertRoute({ ...editRoute, name: patch.name.trim() || editRoute.name, driver: patch.driver.trim(), vehicle: patch.vehicle.trim() || undefined, capacity: Number(patch.capacity) || undefined });
    toast(`Route ${patch.name.trim() || editRoute.name} updated.`);
    setEditRoute(null);
  }

  function deleteRoute(route: Route) {
    if (!confirm(`Delete route “${route.name}”? Its orders will be un-assigned.`)) return;
    scoped.filter((o) => o.routeId === route.id).forEach((o) => upsertOrder({ ...o, routeId: undefined, deliveryChicks: undefined, pickupLocation: undefined }));
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
    if (!o.allocatedOk) return toast("Waiting for hatchery chick allocation — can't mark delivered.", "info");
    const routeName = routes.find((r) => r.id === o.routeId)?.name ?? "route";
    upsertOrder(fulfillOrder(o, user!, `Delivered on ${routeName}`));
    toast(`${o.name} marked delivered.`);
  }

  async function makeDriverLink(route: Route) {
    if (!route.driver.trim()) return toast("This route has no driver name.", "info");
    try {
      const token = await ensureRouteLink(route.id, route.driver.trim(), user!.email);
      const url = `${window.location.origin}/deliver/${token}`;
      setDriverLinks((m) => ({ ...m, [route.id]: url }));
      try {
        await navigator.clipboard.writeText(url);
        toast(`Driver link copied — send it to ${route.driver}.`);
      } catch {
        toast(`Driver link ready for ${route.driver}.`);
      }
    } catch {
      toast("Could not create the driver link.", "info");
    }
  }

  async function showQr(route: Route) {
    if (!route.driver.trim()) return toast("This route has no driver name.", "info");
    let url = driverLinks[route.id];
    if (!url) {
      try {
        const token = await ensureRouteLink(route.id, route.driver.trim(), user!.email);
        url = `${window.location.origin}/deliver/${token}`;
        setDriverLinks((m) => ({ ...m, [route.id]: url! }));
      } catch {
        return toast("Could not create the driver link.", "info");
      }
    }
    setQrFor({ url, driver: route.driver });
  }

  function reschedule(o: Order, newDate: string) {
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

  function doSplit(o: Order, splitQty: number) {
    const { original, child } = splitOrder(o, splitQty, user!, orders, newId);
    upsertOrder(original);
    upsertOrder(child);
    toast(`Split ${o.name}'s order — ${splitQty.toLocaleString()} chicks moved to a new same-day stop for another truck.`);
    setSplitFor(null);
  }

  async function viewProof(o: Order) {
    setProofView({ order: o, proof: null, loading: true });
    const proof = await getDeliveryProof(o.id);
    setProofView({ order: o, proof, loading: false });
  }

  return (
    <div className="space-y-5">
      {/* Fleet autocomplete lists */}
      <datalist id="fleet-drivers">{driverNames.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="fleet-vehicles">{vehiclePlates.map((p) => <option key={p} value={p} />)}</datalist>

      {/* Header (sticks below the app top bar) */}
      <div className="sticky top-16 z-20 -mx-4 flex flex-wrap items-start justify-between gap-3 border-b border-line bg-cream/90 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="min-w-0">
          <Link href="/planning" className="text-sm text-gold-dark underline">← Back to calendar</Link>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">Delivery Planning &amp; Coordination</h1>
          <p className="text-sm text-muted">
            {dateLabel} · <span className="font-semibold text-ink">{kpi.chicks.toLocaleString()}</span> chicks · {kpi.total} stop(s)
            {" · "}<span className="font-semibold text-ink">{kpi.allocPct}%</span> allocated
            {kpi.delivered > 0 && <span className="text-green"> · {kpi.delivered} delivered</span>}
            {kpi.failed > 0 && <span className="text-red"> · {kpi.failed} failed</span>}
            {kpi.balanceToCollect > 0 && <> · <span className="text-red">{formatRWF(kpi.balanceToCollect)}</span> to collect</>}
          </p>
        </div>
        <Pill tone={canEdit ? "gold" : "neutral"}>{canEdit ? "Full access" : "View only"}</Pill>
      </div>

      {/* KPI decks */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Deck title="Orders" tone="gold" icon={<IcoBox />}>
          <Metric label="Total" value={kpi.total} />
          <Metric label="Planned" value={kpi.planned} tone="gold" />
          <Metric label="Delivered" value={kpi.delivered} tone="green" />
          <Metric label="Failed" value={kpi.failed} tone={kpi.failed ? "red" : undefined} />
          <Metric label="Awaiting plan" value={kpi.awaiting} />
        </Deck>
        <Deck title="Production" tone="blue" icon={<IcoChick />}>
          <Metric label="Chicks" value={kpi.chicks.toLocaleString()} />
          <Metric label="Allocated" value={kpi.allocatedChicks.toLocaleString()} tone="green" />
          <Metric label="Remaining" value={kpi.remainingChicks.toLocaleString()} tone={kpi.remainingChicks ? "gold" : undefined} />
          <Metric label="Allocation" value={`${kpi.allocPct}%`} tone={kpi.allocPct >= 100 ? "green" : "gold"} />
        </Deck>
        <Deck title="Collections" tone="purple" icon={<IcoMoney />}>
          <Metric label="Advance paid" value={formatRWF(kpi.advancePaid)} tone="green" />
          <Metric label="Balance to collect" value={formatRWF(kpi.balanceToCollect)} tone="red" />
          <Metric label="Collected (delivered)" value={formatRWF(kpi.collected)} tone="green" />
          <Metric label="Outstanding (delivered)" value={formatRWF(kpi.outstanding)} tone={kpi.outstanding ? "red" : undefined} />
        </Deck>
        <Deck title="Routes" tone="green" icon={<IcoTruck />}>
          <Metric label="Routes" value={kpi.routes} />
          <Metric label="Active" value={kpi.activeRoutes} tone="green" />
          <Metric label="Drivers" value={kpi.drivers} />
          <Metric label="Vehicles" value={kpi.vehicles} />
        </Deck>
      </div>

      {/* Workflow strip */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {flow.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className={cn("rounded-xl border px-3 py-2 text-center", s.count > 0 ? "border-transparent " + TONE_BG[s.tone] : "border-line bg-paper text-muted")}>
                <div className="text-base font-extrabold leading-none tabular-nums">{s.count}</div>
                <div className="mt-0.5 text-[0.62rem] font-semibold uppercase tracking-wide">{s.label}</div>
              </div>
              {i < flow.length - 1 && <span className="text-line">→</span>}
            </div>
          ))}
          {kpi.failed > 0 && (
            <div className="ml-1 flex items-center gap-2">
              <span className="text-line">·</span>
              <div className={cn("rounded-xl px-3 py-2 text-center", TONE_BG.red)}>
                <div className="text-base font-extrabold leading-none tabular-nums">{kpi.failed}</div>
                <div className="mt-0.5 text-[0.62rem] font-semibold uppercase tracking-wide">Failed</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Collections summary */}
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
          <Stat label="Chicks to deliver" value={kpi.chicks.toLocaleString()} />
          <Stat label="Orders" value={String(kpi.total)} />
          <Stat label="Advance paid" value={formatRWF(kpi.advancePaid)} tone="green" />
          <Stat label="Balance to collect" value={formatRWF(kpi.balanceToCollect)} tone="red" />
        </div>
      </Card>

      {/* Routes */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardHeader title={`Routes for ${dateLabel} (${dayRoutes.length})`} />
          {canEdit && <Button size="sm" onClick={() => setShowRouteForm((v) => !v)}>{showRouteForm ? "Cancel" : "＋ Add route"}</Button>}
        </div>
        <p className="-mt-1 mb-3 text-xs text-muted">Routes you add here belong to this delivery date.</p>
        {canEdit && showRouteForm && (
          <form onSubmit={createRoute} className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line p-3">
            <Field label="Route name"><Input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="e.g. Kigali East" /></Field>
            <Field label="Driver" hint={driverNames.length ? "Pick from the fleet or type a name" : undefined}><Input list="fleet-drivers" value={rDriver} onChange={(e) => setRDriver(e.target.value)} placeholder="Driver name" /></Field>
            <Field label="Vehicle (optional)" hint={vehiclePlates.length ? "Pick a plate or type one" : undefined}><Input list="fleet-vehicles" value={rVehicle} onChange={(e) => setRVehicle(e.target.value)} placeholder="e.g. RAD 123 A" /></Field>
            <Field label="Capacity (chicks, optional)"><Input type="number" value={rCap} onChange={(e) => setRCap(e.target.value)} placeholder="e.g. 5000" /></Field>
            <Button type="submit">Add route</Button>
            {rErr && <p className="w-full text-sm text-status-refunded">{rErr}</p>}
          </form>
        )}
        {dayRoutes.length === 0 && <p className="text-sm text-muted">No routes for this day yet.{canEdit ? " Add one above." : ""}</p>}
      </Card>

      {/* Ready to allocate */}
      <Card>
        <CardHeader title={`Orders waiting for allocation (${ready.length})`} />
        <TableWrap>
          <thead><tr><Th>Customer</Th><Th>Product</Th><Th>District / Sector</Th><Th className="text-right">Chicks</Th><Th className="text-right">Balance</Th><Th>Payment</Th><Th>Action</Th></tr></thead>
          <tbody>
            {ready.length === 0 ? <EmptyRow colSpan={7} text="Nothing waiting to be allocated for this day." /> : ready.map((o) => {
              const allocBlock = canAllocate(o);
              return (
              <tr key={o.id}>
                <Td className="font-medium">
                  {o.name} <span className="text-xs text-muted">· {o.phone}</span>
                  {o.debtOk && <span className="ml-2 align-middle"><Pill tone="info">On debt</Pill></span>}
                  {o.splitOf && <span className="ml-2 align-middle"><Pill tone="purple">Split</Pill></span>}
                </Td>
                <Td>{o.product}</Td>
                <Td>{o.district}<div className="text-xs text-muted">{o.sector}</div></Td>
                <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(Math.max(0, balance(o)))}</Td>
                <Td>{paymentCleared(o) ? <Pill tone="green">Cleared</Pill> : <Pill tone="red">Not verified</Pill>}</Td>
                <Td>
                  {canEdit ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-1">
                        <Button size="sm" disabled={!!allocBlock} title={allocBlock ?? undefined} onClick={() => setAllocFor(o)}>Allocate</Button>
                        <Button size="sm" variant="ghost" onClick={() => setSplitFor(o)} disabled={o.chicks <= 1} title={o.chicks <= 1 ? "Nothing to split" : "Split across trucks"}>Split</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRescheduleFor(o)}>Reschedule</Button>
                      </div>
                      {allocBlock && <span className="text-[11px] text-status-refunded">Payment verification required before allocation.</span>}
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
      {dayRoutes.map((route) => {
        const list = routeOrders(route.id);
        const total = list.reduce((s, o) => s + deliverChicks(o), 0);
        const pct = route.capacity ? Math.round((total / route.capacity) * 100) : null;
        const capTone: Tone = pct == null ? "ink" : pct > 100 ? "red" : pct >= 80 ? "amber" : "green";
        const delivered = list.filter((o) => o.deliverOk).length;
        const donePct = list.length ? Math.round((delivered / list.length) * 100) : 0;
        return (
          <Card key={route.id}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="card-title">{route.name}</h3>
                <p className="text-sm text-muted">
                  Driver: <strong className="text-ink">{route.driver || "—"}</strong>
                  {" · "}Vehicle: <strong className="text-ink">{route.vehicle || "—"}</strong>
                  {" · "}{list.length} stop(s) · <strong className="text-ink">{total.toLocaleString()}</strong> chicks
                  {route.capacity ? ` / ${route.capacity.toLocaleString()}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {pct != null && <Pill tone={capTone === "red" ? "red" : capTone === "amber" ? "amber" : "green"}>{pct}% capacity</Pill>}
                  <span className="text-xs text-muted">Completion</span>
                  <div className="h-2 w-28 overflow-hidden rounded-full bg-grey-bg">
                    <div className={cn("h-full rounded-full", donePct === 100 ? "bg-green" : "bg-gold")} style={{ width: `${donePct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-ink">{donePct}%</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => void manifestPDF(route, dateLabel, list, dsrs)} disabled={list.length === 0}>Manifest (PDF)</Button>
                <Button variant="ghost" size="sm" onClick={() => downloadCsv(route, dateLabel, list)} disabled={list.length === 0}>CSV</Button>
                {canEdit && <Button variant="ghost" size="sm" onClick={() => makeDriverLink(route)}>Driver link</Button>}
                {canEdit && <Button variant="ghost" size="sm" onClick={() => void showQr(route)}>QR</Button>}
                {canEdit && <Button variant="ghost" size="sm" onClick={() => setEditRoute(route)}>Edit</Button>}
                {canEdit && <Button variant="ghost" size="sm" onClick={() => deleteRoute(route)}>Delete</Button>}
              </div>
            </div>
            {driverLinks[route.id] && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#efdfae] bg-gold-bg px-3 py-2 text-xs">
                <span className="shrink-0 font-semibold text-ink">Driver link for {route.name} ({route.driver}):</span>
                <input readOnly value={driverLinks[route.id]} onFocus={(e) => e.currentTarget.select()} className="min-w-0 grow bg-transparent text-gold-dark outline-none" />
                <button type="button" onClick={() => makeDriverLink(route)} className="shrink-0 font-semibold text-gold-dark underline">Copy</button>
              </div>
            )}
            <TableWrap>
              <thead><tr><Th>Customer</Th><Th>Product</Th><Th>Contact</Th><Th>Pickup</Th><Th>Sector</Th><Th className="text-right">Chicks</Th><Th>Hatchery</Th>{canEdit && <Th></Th>}</tr></thead>
              <tbody>
                {list.length === 0 ? <EmptyRow colSpan={canEdit ? 8 : 7} text="No stops on this route for this day." /> : list.map((o) => (
                  <tr key={o.id} className={o.deliverOk ? "bg-green-bg" : undefined}>
                    <Td className="font-medium">
                      {o.name}
                      {o.deliverOk && <span className="ml-2 align-middle"><Pill tone="green">Delivered ✓</Pill></span>}
                      {o.deliverOk && o.hasProof && <button type="button" onClick={() => viewProof(o)} className="ml-2 align-middle text-xs font-semibold text-blue underline">View proof</button>}
                      {o.deliveryFail && !o.deliverOk && <span className="ml-2 align-middle"><Pill tone="red">Not delivered</Pill></span>}
                      {o.deliveryFail && !o.deliverOk && <div className="text-xs font-normal text-muted">{o.deliveryFail.reason}</div>}
                    </Td>
                    <Td><Pill tone={o.product === "Ross 308" ? "info" : "gold"}>{o.product === "Ross 308" ? "Ross" : "Tetra"}</Pill></Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <a href={`tel:${o.phone}`} title="Call" className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-green hover:bg-green-bg"><IcoPhone /></a>
                        <a href={waHref(o.phone)} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-green hover:bg-green-bg"><IcoChat /></a>
                        <a href={mapHref(o)} target="_blank" rel="noopener noreferrer" title="Directions" className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-blue hover:bg-blue-bg"><IcoPin /></a>
                        <span className="ml-1 text-xs text-muted">{o.phone}</span>
                      </div>
                    </Td>
                    <Td>{o.pickupLocation ?? "—"}</Td>
                    <Td>{o.sector}</Td>
                    <Td className="text-right">{deliverChicks(o).toLocaleString()}</Td>
                    <Td>{o.allocatedOk ? <Pill tone="green">Allocated</Pill> : <Pill tone="amber">Awaiting</Pill>}</Td>
                    {canEdit && (
                      <Td>
                        {o.deliverOk ? (
                          <span className="text-xs font-medium text-green">Delivered</span>
                        ) : (
                          <div className="flex gap-1">
                            <Button size="sm" disabled={!o.allocatedOk} title={o.allocatedOk ? undefined : "Waiting for hatchery chick allocation"} onClick={() => markDelivered(o)}>Delivered</Button>
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

      {/* Analytics — deliveries by district */}
      {dayOrders.length > 0 && (
        <Card>
          <CardHeader title="Deliveries by district" />
          <TableWrap>
            <thead><tr><Th>District</Th><Th className="text-right">Stops</Th><Th className="text-right">Chicks</Th><Th className="text-right">Delivered</Th><Th className="text-right">Progress</Th></tr></thead>
            <tbody>
              {byDistrict.map(([district, g]) => (
                <tr key={district}>
                  <Td className="font-medium">{district}</Td>
                  <Td className="text-right">{g.stops}</Td>
                  <Td className="text-right">{g.chicks.toLocaleString()}</Td>
                  <Td className="text-right">{g.delivered}</Td>
                  <Td className="text-right">{g.stops ? Math.round((g.delivered / g.stops) * 100) : 0}%</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {/* Analytics — collections by route */}
      {byRoute.length > 0 && (
        <Card>
          <CardHeader title="Collections by route" />
          <TableWrap>
            <thead><tr><Th>Route</Th><Th>Driver</Th><Th className="text-right">Stops</Th><Th className="text-right">Chicks</Th><Th className="text-right">Advance paid</Th><Th className="text-right">To collect</Th><Th className="text-right">Delivered</Th></tr></thead>
            <tbody>
              {byRoute.map((x) => (
                <tr key={x.r.id}>
                  <Td className="font-medium">{x.r.name}</Td>
                  <Td>{x.r.driver || "—"}</Td>
                  <Td className="text-right">{x.stops}</Td>
                  <Td className="text-right">{x.chicks.toLocaleString()}</Td>
                  <Td className="text-right text-green">{formatRWF(x.advance)}</Td>
                  <Td className="text-right text-red">{formatRWF(x.expected)}</Td>
                  <Td className="text-right">{x.delivered}/{x.stops}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {/* Failed deliveries */}
      {failedList.length > 0 && (
        <Card>
          <CardHeader title={`Failed deliveries (${failedList.length})`} />
          <TableWrap>
            <thead><tr><Th>Customer</Th><Th>Route</Th><Th>Reason</Th>{canEdit && <Th></Th>}</tr></thead>
            <tbody>
              {failedList.map((o) => (
                <tr key={o.id}>
                  <Td className="font-medium">{o.name}<div className="text-xs text-muted">{o.phone}</div></Td>
                  <Td>{routes.find((r) => r.id === o.routeId)?.name ?? "—"}</Td>
                  <Td className="text-red">{o.deliveryFail?.reason}</Td>
                  {canEdit && <Td><Button size="sm" variant="ghost" onClick={() => setRescheduleFor(o)}>Reschedule</Button></Td>}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {allocFor && (
        <AllocateDrawer order={allocFor} routes={dayRoutes} onClose={() => setAllocFor(null)} onSave={(chicks, pickup, routeId) => allocate(allocFor, chicks, pickup, routeId)} />
      )}
      {rescheduleFor && (
        <RescheduleModal
          order={rescheduleFor}
          routeName={rescheduleFor.routeId ? routes.find((r) => r.id === rescheduleFor.routeId)?.name : undefined}
          onClose={() => setRescheduleFor(null)}
          onSave={(date) => reschedule(rescheduleFor, date)}
        />
      )}
      {editRoute && (
        <EditRouteModal route={editRoute} onClose={() => setEditRoute(null)} onSave={saveRouteEdit} />
      )}
      {proofView && (
        <ProofModal state={proofView} onClose={() => setProofView(null)} />
      )}
      {splitFor && (
        <SplitModal order={splitFor} onClose={() => setSplitFor(null)} onSave={(qty) => doSplit(splitFor, qty)} />
      )}
      {qrFor && (
        <QRModal url={qrFor.url} driver={qrFor.driver} onClose={() => setQrFor(null)} />
      )}
    </div>
  );
}

function QRModal({ url, driver, onClose }: { url: string; driver: string; onClose: () => void }) {
  const [img, setImg] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, { width: 256, margin: 1 }).then((d) => { if (active) setImg(d); }).catch(() => {});
    return () => { active = false; };
  }, [url]);
  return (
    <Modal open onClose={onClose} title={`Driver QR — ${driver}`} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex flex-col items-center gap-3 text-center">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated QR data URL
          <img src={img} alt={`QR code for ${driver}'s route`} className="h-56 w-56 rounded-lg border border-line" />
        ) : (
          <p className="py-16 text-sm text-muted">Generating QR…</p>
        )}
        <p className="text-sm text-muted">Ask {driver} to scan this to open today&apos;s route on their phone — no link needed.</p>
        <code className="max-w-full truncate rounded bg-ink/5 px-2 py-1 text-xs text-muted">{url}</code>
      </div>
    </Modal>
  );
}

function SplitModal({ order, onClose, onSave }: {
  order: Order; onClose: () => void; onSave: (splitQty: number) => void;
}) {
  const [qty, setQty] = useState(String(Math.floor(order.chicks / 2)));
  const [err, setErr] = useState<string | null>(null);
  const n = Number(qty) || 0;
  const keep = order.chicks - n;
  return (
    <Modal open onClose={onClose} title={`Split order — ${order.name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => {
          if (n <= 0) return setErr("Enter how many chicks to split off.");
          if (n >= order.chicks) return setErr(`Split off fewer than the ${order.chicks.toLocaleString()} ordered.`);
          onSave(n);
        }}>Split order</Button>
      </>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">{order.product} · {order.district} · {order.chicks.toLocaleString()} chicks total. The split-off portion becomes a separate <strong className="text-ink">same-day</strong> stop you can put on another truck. The customer keeps one balance — any surplus payment moves across as credit.</p>
        <Field label="Chicks to split off"><Input type="number" min={1} max={order.chicks - 1} value={qty} onChange={(e) => { setQty(e.target.value); setErr(null); }} /></Field>
        {n > 0 && n < order.chicks && (
          <div className="rounded-xl border border-line bg-cream/40 px-3 py-2 text-ink">
            Original keeps <strong>{keep.toLocaleString()}</strong> · new stop gets <strong>{n.toLocaleString()}</strong>
          </div>
        )}
        {err && <p className="text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

function ProofModal({ state, onClose }: {
  state: { order: Order; proof: DeliveryProof | null; loading: boolean }; onClose: () => void;
}) {
  const { order, proof, loading } = state;
  return (
    <Modal open onClose={onClose} title={`Proof of delivery — ${order.name}`} footer={<Button onClick={onClose}>Close</Button>}>
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !proof ? (
        <p className="text-sm text-muted">No proof recorded for this delivery.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {proof.on && <p className="text-xs text-muted">Captured {formatDate(proof.on.slice(0, 10))}{proof.by ? ` · ${proof.by}` : ""}</p>}
          {proof.gps ? (
            <a href={`https://www.google.com/maps/search/?api=1&query=${proof.gps.lat},${proof.gps.lng}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue underline">
              📍 View delivery location{proof.gps.accuracy ? ` (±${Math.round(proof.gps.accuracy)}m)` : ""}
            </a>
          ) : <p className="text-muted">No location captured.</p>}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Customer signature</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- runtime data URL */}
            {proof.signature ? <img src={proof.signature} alt="signature" className="w-full rounded-lg border border-line bg-white" /> : <p className="text-muted">—</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Delivery photo</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- runtime data URL */}
            {proof.photo ? <img src={proof.photo} alt="delivery" className="w-full rounded-lg border border-line" /> : <p className="text-muted">—</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---- small presentational pieces ------------------------------------------

function Deck({ title, tone, icon, children }: { title: string; tone: Tone; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", TONE_BG[tone])}>{icon}</span>
        <h3 className="text-[0.72rem] font-bold uppercase tracking-wide text-muted">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: ReactNode; tone?: "green" | "red" | "gold" }) {
  const c = tone === "green" ? "text-green" : tone === "red" ? "text-red" : tone === "gold" ? "text-gold-dark" : "text-ink";
  return (
    <div>
      <p className={cn("truncate text-lg font-extrabold leading-none tabular-nums", c)}>{value}</p>
      <p className="mt-1 text-[0.66rem] text-muted">{label}</p>
    </div>
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

// ---- inline icons ---------------------------------------------------------

const svg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoBox = () => svg(<><path d="M4 6.5 10 4l6 2.5v7L10 16l-6-2.5v-7Z" /><path d="M4 6.5 10 9l6-2.5M10 9v7" /></>);
const IcoChick = () => svg(<><ellipse cx="10" cy="11" rx="5" ry="6" /><path d="M10 5V3.5" /></>);
const IcoMoney = () => svg(<><rect x="3.5" y="6" width="13" height="8" rx="1.5" /><circle cx="10" cy="10" r="2" /></>);
const IcoTruck = () => svg(<><path d="M2.5 6.5h9v7h-9zM11.5 9h3l2 2.5v2h-5z" /><circle cx="6" cy="15" r="1.3" /><circle cx="14" cy="15" r="1.3" /></>);
const IcoPhone = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 10.8a12 12 0 0 0 5.6 5.6l1.9-1.9a1 1 0 0 1 1-.24 11 11 0 0 0 3.4.55 1 1 0 0 1 1 1V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1c0 1.2.19 2.34.55 3.4a1 1 0 0 1-.24 1z" /></svg>;
const IcoChat = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v11H8l-4 3z" /></svg>;
const IcoPin = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z" /><circle cx="12" cy="10" r="2.4" /></svg>;

// ---- modals ---------------------------------------------------------------

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

function EditRouteModal({ route, onClose, onSave }: {
  route: Route; onClose: () => void; onSave: (patch: { name: string; driver: string; vehicle: string; capacity: string }) => void;
}) {
  const [name, setName] = useState(route.name);
  const [driver, setDriver] = useState(route.driver);
  const [vehicle, setVehicle] = useState(route.vehicle ?? "");
  const [capacity, setCapacity] = useState(route.capacity ? String(route.capacity) : "");
  return (
    <Modal open onClose={onClose} title={`Edit route — ${route.name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave({ name, driver, vehicle, capacity })}>Save route</Button>
      </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Route name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Driver"><Input list="fleet-drivers" value={driver} onChange={(e) => setDriver(e.target.value)} /></Field>
        <Field label="Vehicle"><Input list="fleet-vehicles" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. RAD 123 A" /></Field>
        <Field label="Capacity (chicks)"><Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function AllocateDrawer({ order, routes, onClose, onSave }: {
  order: Order; routes: Route[]; onClose: () => void; onSave: (chicks: number, pickup: string, routeId: string) => void;
}) {
  const [chicks, setChicks] = useState(String(toDeliver(order)));
  const [pickup, setPickup] = useState(order.pickupLocation?.trim() || "Hatchery");
  const [routeId, setRouteId] = useState(routes[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const route = routes.find((r) => r.id === routeId);

  function submit() {
    const n = Number(chicks) || 0;
    if (routes.length === 0) return setErr("Create a route first.");
    if (!routeId) return setErr("Choose a route.");
    if (n <= 0) return setErr("Enter the chicks to deliver.");
    if (!pickup.trim()) return setErr("Enter the pickup location.");
    onSave(n, pickup.trim(), routeId);
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col bg-paper shadow-pop">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-lg font-bold text-ink">Allocate — {order.name}</h3>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:bg-grey-bg" aria-label="Close">✕</button>
        </div>
        <div className="grow space-y-3 overflow-y-auto p-5 text-sm">
          <p className="text-muted">{order.product} · {order.district} · to deliver {toDeliver(order).toLocaleString()} chicks</p>
          <Field label="Route">
            {routes.length === 0 ? <p className="text-status-refunded">No routes yet — create one on the page first.</p> : (
              <Select value={routeId} onChange={(e) => setRouteId(e.target.value)} options={routes.map((r) => ({ value: r.id, label: `${r.name} — ${r.driver}${r.vehicle ? ` (${r.vehicle})` : ""}` }))} />
            )}
          </Field>
          {route && (
            <div className="rounded-xl border border-line bg-cream/40 px-3 py-2 text-xs text-muted">
              Driver: <strong className="text-ink">{route.driver || "—"}</strong> · Vehicle: <strong className="text-ink">{route.vehicle || "—"}</strong>
              {route.capacity ? <> · Capacity {route.capacity.toLocaleString()}</> : null}
            </div>
          )}
          <Field label="Chicks to deliver"><Input type="number" min={1} value={chicks} onChange={(e) => setChicks(e.target.value)} /></Field>
          <Field label="Pickup location" hint={order.pickupLocation ? "From the order — edit if it changed" : undefined}>
            <Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="Where the chicks are picked up" />
          </Field>
          {err && <p className="text-status-refunded">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Allocate</Button>
        </div>
      </div>
    </div>
  );
}
