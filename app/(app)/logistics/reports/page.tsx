"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TableWrap, Th, Td } from "@/components/ui/Table";
import { formatRWF } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  expiryState, listDispatches, listDrivers, listVehicles,
  type DeliveryDispatch, type Driver, type Vehicle,
} from "@/lib/logistics";
import {
  listPurchaseOrders, listReceipts, grnAcceptedValue, poOrderedQty, poReceivedQty, poTotal, threeWayMatch,
  type GoodsReceipt, type PurchaseOrder,
} from "@/lib/procurement";
import {
  listTrips, tripDistance, tripFuelCost, tripFuelLitres, tripMetrics, tripTotalCost, tripConsumption,
  type Trip,
} from "@/lib/trips";
import { listLogisticsExpenses, type LogisticsExpense } from "@/lib/logisticsOps";

type Tab = "deliveries" | "procurement" | "fleet" | "costs" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "deliveries", label: "Deliveries" },
  { id: "procurement", label: "Procurement" },
  { id: "fleet", label: "Fleet & fuel" },
  { id: "costs", label: "Costs" },
  { id: "audit", label: "Audit trail" },
];

interface Col { key: string; label: string; align?: "right" }
function toCsv(cols: Col[], rows: Record<string, string | number>[]): string {
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\n");
}
function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

function Report({ title, cols, rows, note }: { title: string; cols: Col[]; rows: Record<string, string | number>[]; note?: string }) {
  return (
    <Card>
      <CardHeader title={`${title} (${rows.length})`} action={<Button size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => download(`${title.replace(/\s+/g, "-").toLowerCase()}.csv`, toCsv(cols, rows))}>CSV</Button>} />
      {note && <p className="-mt-1 mb-2 text-xs text-muted">{note}</p>}
      <TableWrap>
        <thead><tr>{cols.map((c) => <Th key={c.key} className={c.align === "right" ? "text-right" : ""}>{c.label}</Th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={cols.length} className="p-3 text-center text-sm text-muted">Nothing to report yet.</td></tr>
            : rows.map((r, i) => <tr key={i}>{cols.map((c) => <Td key={c.key} className={c.align === "right" ? "text-right" : ""}>{r[c.key]}</Td>)}</tr>)}
        </tbody>
      </TableWrap>
    </Card>
  );
}

export default function LogisticsReportsPage() {
  const { user } = useAuth();
  const { orders } = useData();
  const [tab, setTab] = useState<Tab>("deliveries");
  const [dispatches, setDispatches] = useState<DeliveryDispatch[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [grns, setGrns] = useState<GoodsReceipt[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [expenses, setExpenses] = useState<LogisticsExpense[]>([]);

  const canUse = user?.role === "Admin" || user?.role === "Logistics Officer";

  const load = useCallback(async () => {
    try {
      const [d, t, p, g, v, dr, e] = await Promise.all([listDispatches(), listTrips(), listPurchaseOrders(), listReceipts(), listVehicles(), listDrivers(), listLogisticsExpenses()]);
      setDispatches(d); setTrips(t); setPos(p); setGrns(g); setVehicles(v); setDrivers(dr); setExpenses(e);
    } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let to: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("logi-reports-live").on("postgres_changes", { event: "*", schema: "public" }, () => { if (to) clearTimeout(to); to = setTimeout(() => void load(), 500); }).subscribe();
    return () => { if (to) clearTimeout(to); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const vehName = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles]);
  const drvName = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers]);
  const dispById = useMemo(() => new Map(dispatches.map((d) => [d.id, d])), [dispatches]);
  const poById = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for Logistics and Admin.</p></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Operational logistics reports — export any table as CSV, or print the page.</p>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>Print</Button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "deliveries" && <DeliveryReports dispatches={dispatches} vehName={vehName} drvName={drvName} />}
      {tab === "procurement" && <ProcurementReports pos={pos} grns={grns} poById={poById} />}
      {tab === "fleet" && <FleetReports trips={trips} vehicles={vehicles} vehName={vehName} />}
      {tab === "costs" && <CostReports trips={trips} dispById={dispById} vehName={vehName} expenses={expenses} orders={orders} />}
      {tab === "audit" && <AuditReport dispatches={dispatches} trips={trips} pos={pos} grns={grns} expenses={expenses} />}
    </div>
  );
}

function DeliveryReports({ dispatches, vehName, drvName }: { dispatches: DeliveryDispatch[]; vehName: Map<string, string>; drvName: Map<string, string> }) {
  const status = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dispatches) m.set(d.status, (m.get(d.status) ?? 0) + 1);
    return [...m.entries()].map(([k, v]) => ({ status: k, count: v }));
  }, [dispatches]);
  const detail = dispatches.map((d) => ({ ref: d.ref, date: formatDate(d.date), vehicle: vehName.get(d.vehicleId ?? "") ?? "—", driver: drvName.get(d.driverId ?? "") ?? "—", stops: d.stops.length, chicks: d.stops.reduce((s, x) => s + x.chicks, 0), delivered: d.stops.reduce((s, x) => s + (x.delivered ?? 0), 0), status: d.status }));
  const failed = dispatches.flatMap((d) => d.stops.filter((s) => s.outcome === "failed").map((s) => ({ ref: d.ref, date: formatDate(d.date), customer: s.customer, product: s.product, chicks: s.chicks, reason: s.failReason ?? "" })));
  const pod = dispatches.flatMap((d) => d.stops.filter((s) => s.outcome === "delivered").map((s) => ({ ref: d.ref, customer: s.customer, product: s.product, planned: s.chicks, delivered: s.delivered ?? 0, doa: s.doa ?? 0, pod: s.podRef ?? "" })));
  const disc = dispatches.flatMap((d) => d.stops.filter((s) => s.outcome && (s.delivered ?? 0) !== s.chicks).map((s) => ({ ref: d.ref, customer: s.customer, planned: s.chicks, delivered: s.delivered ?? 0, short: s.chicks - (s.delivered ?? 0), outcome: s.outcome ?? "" })));
  return (
    <div className="space-y-5">
      <Report title="Delivery status summary" cols={[{ key: "status", label: "Status" }, { key: "count", label: "Dispatches", align: "right" }]} rows={status} />
      <Report title="Delivery detail" cols={[{ key: "ref", label: "Ref" }, { key: "date", label: "Date" }, { key: "vehicle", label: "Vehicle" }, { key: "driver", label: "Driver" }, { key: "stops", label: "Stops", align: "right" }, { key: "chicks", label: "Chicks", align: "right" }, { key: "delivered", label: "Delivered", align: "right" }, { key: "status", label: "Status" }]} rows={detail} />
      <Report title="Failed deliveries" cols={[{ key: "ref", label: "Dispatch" }, { key: "date", label: "Date" }, { key: "customer", label: "Customer" }, { key: "product", label: "Product" }, { key: "chicks", label: "Chicks", align: "right" }, { key: "reason", label: "Reason" }]} rows={failed} />
      <Report title="Proof of delivery" cols={[{ key: "ref", label: "Dispatch" }, { key: "customer", label: "Customer" }, { key: "product", label: "Product" }, { key: "planned", label: "Planned", align: "right" }, { key: "delivered", label: "Delivered", align: "right" }, { key: "doa", label: "DOA", align: "right" }, { key: "pod", label: "POD ref" }]} rows={pod} />
      <Report title="Delivery discrepancies" note="Stops where the delivered quantity differed from what was dispatched." cols={[{ key: "ref", label: "Dispatch" }, { key: "customer", label: "Customer" }, { key: "planned", label: "Planned", align: "right" }, { key: "delivered", label: "Delivered", align: "right" }, { key: "short", label: "Difference", align: "right" }, { key: "outcome", label: "Outcome" }]} rows={disc} />
    </div>
  );
}

function ProcurementReports({ pos, grns, poById }: { pos: PurchaseOrder[]; grns: GoodsReceipt[]; poById: Map<string, PurchaseOrder> }) {
  const poRows = pos.map((p) => ({ ref: p.ref, supplier: p.supplierName, total: formatRWF(poTotal(p)), received: `${poReceivedQty(p.id, grns)} / ${poOrderedQty(p)}`, delivery: p.deliveryDate ? formatDate(p.deliveryDate) : "—", status: p.status }));
  const grnRows = grns.map((g) => { const m = threeWayMatch(poById.get(g.poId), g); return { ref: g.ref, po: g.poRef, supplier: g.supplierName, date: formatDate(g.receivedDate), accepted: formatRWF(grnAcceptedValue(g)), invoice: g.invoiceNo ?? "—", match: m.state, finance: g.handedToFinance ? "handed off" : "held" }; });
  const perf = useMemo(() => {
    const m = new Map<string, { pos: number; onTime: number; late: number }>();
    for (const g of grns) { const po = poById.get(g.poId); const g0 = m.get(g.supplierName) ?? { pos: 0, onTime: 0, late: 0 }; g0.pos += 1; if (po?.deliveryDate) { if (g.receivedDate <= po.deliveryDate) g0.onTime += 1; else g0.late += 1; } m.set(g.supplierName, g0); }
    return [...m.entries()].map(([supplier, v]) => ({ supplier, deliveries: v.pos, onTime: v.onTime, late: v.late }));
  }, [grns, poById]);
  return (
    <div className="space-y-5">
      <Report title="Purchase order status" cols={[{ key: "ref", label: "PO" }, { key: "supplier", label: "Supplier" }, { key: "total", label: "Total", align: "right" }, { key: "received", label: "Received" }, { key: "delivery", label: "Delivery" }, { key: "status", label: "Status" }]} rows={poRows} />
      <Report title="Goods received" cols={[{ key: "ref", label: "GRN" }, { key: "po", label: "PO" }, { key: "supplier", label: "Supplier" }, { key: "date", label: "Date" }, { key: "accepted", label: "Accepted value", align: "right" }, { key: "invoice", label: "Invoice" }, { key: "match", label: "Match" }, { key: "finance", label: "Finance" }]} rows={grnRows} />
      <Report title="Supplier delivery performance" note="On-time = goods received on or before the PO delivery date." cols={[{ key: "supplier", label: "Supplier" }, { key: "deliveries", label: "Deliveries", align: "right" }, { key: "onTime", label: "On time", align: "right" }, { key: "late", label: "Late", align: "right" }]} rows={perf} />
    </div>
  );
}

function FleetReports({ trips, vehicles, vehName }: { trips: Trip[]; vehicles: Vehicle[]; vehName: Map<string, string> }) {
  const usage = useMemo(() => {
    const m = new Map<string, { trips: number; km: number; fuel: number; cost: number }>();
    for (const t of trips) { if (t.status === "Cancelled") continue; const k = vehName.get(t.vehicleId ?? "") ?? "Unassigned"; const g = m.get(k) ?? { trips: 0, km: 0, fuel: 0, cost: 0 }; g.trips += 1; g.km += tripDistance(t); g.fuel += tripFuelLitres(t); g.cost += tripTotalCost(t); m.set(k, g); }
    return [...m.entries()].map(([vehicle, v]) => ({ vehicle, trips: v.trips, km: v.km.toLocaleString(), fuel: `${Math.round(v.fuel)} L`, cost: formatRWF(v.cost) }));
  }, [trips, vehName]);
  const fuel = trips.filter((t) => tripFuelLitres(t) > 0).map((t) => { const c = tripConsumption(t); return { ref: t.ref, vehicle: vehName.get(t.vehicleId ?? "") ?? "—", km: tripDistance(t).toLocaleString(), litres: tripFuelLitres(t), l100: c.l100 || "—", cost: formatRWF(tripFuelCost(t)), flag: c.unusual ? "check" : "" }; });
  const today = new Date().toISOString().slice(0, 10);
  const docs = vehicles.filter((v) => v.active).map((v) => ({ plate: v.plate, insurance: v.insuranceExpiry ? `${formatDate(v.insuranceExpiry)} (${expiryState(v.insuranceExpiry, today)})` : "—", inspection: v.inspectionExpiry ? `${formatDate(v.inspectionExpiry)} (${expiryState(v.inspectionExpiry, today)})` : "—", availability: v.availability }));
  return (
    <div className="space-y-5">
      <Report title="Vehicle usage" cols={[{ key: "vehicle", label: "Vehicle" }, { key: "trips", label: "Trips", align: "right" }, { key: "km", label: "Distance", align: "right" }, { key: "fuel", label: "Fuel", align: "right" }, { key: "cost", label: "Cost", align: "right" }]} rows={usage} />
      <Report title="Fuel consumption" note="Consumption in litres per 100 km; flagged for review when unusual." cols={[{ key: "ref", label: "Trip" }, { key: "vehicle", label: "Vehicle" }, { key: "km", label: "Distance", align: "right" }, { key: "litres", label: "Litres", align: "right" }, { key: "l100", label: "L/100km", align: "right" }, { key: "cost", label: "Fuel cost", align: "right" }, { key: "flag", label: "Flag" }]} rows={fuel} />
      <Report title="Vehicle documents & maintenance" cols={[{ key: "plate", label: "Vehicle" }, { key: "insurance", label: "Insurance" }, { key: "inspection", label: "Inspection" }, { key: "availability", label: "Status" }]} rows={docs} />
    </div>
  );
}

function CostReports({ trips, dispById, vehName, expenses, orders }: {
  trips: Trip[]; dispById: Map<string, DeliveryDispatch>; vehName: Map<string, string>; expenses: LogisticsExpense[]; orders: ReturnType<typeof useData>["orders"];
}) {
  const tripRows = trips.filter((t) => t.status !== "Cancelled").map((t) => { const m = tripMetrics(t, t.dispatchId ? dispById.get(t.dispatchId) : undefined); return { ref: t.ref, vehicle: vehName.get(t.vehicleId ?? "") ?? "—", km: m.distance.toLocaleString(), total: formatRWF(m.totalCost), perKm: m.costPerKm ? formatRWF(m.costPerKm) : "—", perChick: m.costPerChick ? formatRWF(m.costPerChick) : "—", allocation: t.allocation }; });
  const route = useMemo(() => {
    const m = new Map<string, { trips: number; cost: number; chicks: number }>();
    for (const t of trips) { if (t.status === "Cancelled") continue; const disp = t.dispatchId ? dispById.get(t.dispatchId) : undefined; const met = tripMetrics(t, disp); const k = t.route || "—"; const g = m.get(k) ?? { trips: 0, cost: 0, chicks: 0 }; g.trips += 1; g.cost += met.totalCost; g.chicks += met.chicks; m.set(k, g); }
    return [...m.entries()].map(([route, v]) => ({ route, trips: v.trips, chicks: v.chicks.toLocaleString(), cost: formatRWF(v.cost), perChick: v.chicks > 0 ? formatRWF(v.cost / v.chicks) : "—" }));
  }, [trips, dispById]);
  const exp = expenses.map((e) => ({ ref: e.ref, date: formatDate(e.date), category: e.category, payee: e.payee ?? "—", amount: formatRWF(e.amount), status: e.status, payment: e.paymentStatus ?? "—" }));
  return (
    <div className="space-y-5">
      <Report title="Trip cost report" note="Per-chick figures come from the trip's linked delivery dispatch." cols={[{ key: "ref", label: "Trip" }, { key: "vehicle", label: "Vehicle" }, { key: "km", label: "Distance", align: "right" }, { key: "total", label: "Total cost", align: "right" }, { key: "perKm", label: "Cost/km", align: "right" }, { key: "perChick", label: "Cost/chick", align: "right" }, { key: "allocation", label: "Allocation" }]} rows={tripRows} />
      <Report title="Route cost & profitability" note="Delivery cost per chick by route." cols={[{ key: "route", label: "Route" }, { key: "trips", label: "Trips", align: "right" }, { key: "chicks", label: "Chicks", align: "right" }, { key: "cost", label: "Cost", align: "right" }, { key: "perChick", label: "Cost/chick", align: "right" }]} rows={route} />
      <Report title="Logistics expense report" cols={[{ key: "ref", label: "Ref" }, { key: "date", label: "Date" }, { key: "category", label: "Category" }, { key: "payee", label: "Payee" }, { key: "amount", label: "Amount", align: "right" }, { key: "status", label: "Status" }, { key: "payment", label: "Payment" }]} rows={exp} />
      <p className="text-xs text-muted">Orders on record: {orders.length.toLocaleString()} — route profitability compares delivery cost against the chicks actually delivered on each route.</p>
    </div>
  );
}

function AuditReport({ dispatches, trips, pos, grns, expenses }: {
  dispatches: DeliveryDispatch[]; trips: Trip[]; pos: PurchaseOrder[]; grns: GoodsReceipt[]; expenses: LogisticsExpense[];
}) {
  const rows = useMemo(() => {
    const out: { when: string; ref: string; entity: string; line: string }[] = [];
    const add = (entity: string, ref: string, history: string[]) => { for (const h of history ?? []) { const [iso, ...rest] = h.split(" · "); out.push({ when: iso, ref, entity, line: rest.join(" · ") }); } };
    dispatches.forEach((d) => add("Dispatch", d.ref, d.history));
    trips.forEach((t) => add("Trip", t.ref, t.history));
    pos.forEach((p) => add("Purchase order", p.ref, p.history));
    grns.forEach((g) => add("Goods received", g.ref, g.history));
    expenses.forEach((e) => add("Expense", e.ref, e.history));
    return out.sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 300)
      .map((r) => ({ when: r.when.replace("T", " ").slice(0, 16), entity: r.entity, ref: r.ref, line: r.line }));
  }, [dispatches, trips, pos, grns, expenses]);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Every logistics record keeps an append-only history of who did what and when. Newest 300 actions across the module — completed records are never deleted; corrections are made through cancellations and reversals.</p>
      <Report title="Logistics audit trail" cols={[{ key: "when", label: "When" }, { key: "entity", label: "Record" }, { key: "ref", label: "Ref" }, { key: "line", label: "Action" }]} rows={rows} />
    </div>
  );
}
