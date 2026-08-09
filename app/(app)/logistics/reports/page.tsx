"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useLang } from "@/components/LanguageProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TableWrap, Th, Td } from "@/components/ui/Table";
import { SearchTimeBar } from "@/components/dashboard/DashKit";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { presetToRange, type PeriodPreset } from "@/lib/period";
import { formatRWF } from "@/lib/config";
import { formatDate, todayISO } from "@/lib/format";
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
  const { t } = useLang();
  return (
    <Card>
      <CardHeader title={`${title} (${rows.length})`} action={<Button size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => download(`${title.replace(/\s+/g, "-").toLowerCase()}.csv`, toCsv(cols, rows))}>{t("CSV")}</Button>} />
      {note && <p className="-mt-1 mb-2 text-xs text-muted">{note}</p>}
      <TableWrap>
        <thead><tr>{cols.map((c) => <Th key={c.key} className={c.align === "right" ? "text-right" : ""}>{c.label}</Th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={cols.length} className="p-3 text-center text-sm text-muted">{t("Nothing to report yet.")}</td></tr>
            : rows.map((r, i) => <tr key={i}>{cols.map((c) => <Td key={c.key} className={c.align === "right" ? "text-right" : ""}>{r[c.key]}</Td>)}</tr>)}
        </tbody>
      </TableWrap>
    </Card>
  );
}

export default function LogisticsReportsPage() {
  const { t } = useLang();
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

  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const today = todayISO();
  const range = useMemo(() => presetToRange(preset, custom, today), [preset, custom, today]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">{t("This page is for Logistics and Admin.")}</p></Card>;

  // Period + search filters applied to each record's date/ref before reporting.
  const noRange = !range.from && !range.to;
  const mq = q.trim().toLowerCase();
  const inP = (iso?: string) => (noRange ? true : !!iso && inRange(iso.slice(0, 10), range));
  const hit = (text: string) => !mq || text.toLowerCase().includes(mq);
  const tripDate = (t: Trip) => (t.departAt && /^\d{4}-\d{2}-\d{2}/.test(t.departAt) ? t.departAt : t.on);

  const fDispatches = dispatches.filter((d) => inP(d.date) && hit(`${d.ref} ${vehName.get(d.vehicleId ?? "") ?? ""} ${drvName.get(d.driverId ?? "") ?? ""}`));
  const fTrips = trips.filter((t) => inP(tripDate(t)) && hit(`${t.ref} ${t.route ?? ""} ${vehName.get(t.vehicleId ?? "") ?? ""}`));
  const fPos = pos.filter((p) => inP(p.deliveryDate ?? p.on) && hit(`${p.ref} ${p.supplierName}`));
  const fGrns = grns.filter((g) => inP(g.receivedDate) && hit(`${g.ref} ${g.poRef} ${g.supplierName}`));
  const fExpenses = expenses.filter((e) => inP(e.date) && hit(`${e.ref} ${e.category} ${e.payee ?? ""}`));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 sticky top-16 z-20 -mx-4 md:-mx-8 border-b border-line bg-cream/95 px-4 md:px-8 py-2.5 backdrop-blur">
        <div className="min-w-0 flex-1"><SearchTimeBar q={q} setQ={setQ} placeholder={t("Search these reports…")} preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} /></div>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>{t("Print")}</Button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((tb) => (
          <button key={tb.id} type="button" onClick={() => setTab(tb.id)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === tb.id ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>{t(tb.label)}</button>
        ))}
      </div>

      {tab === "deliveries" && <DeliveryReports dispatches={fDispatches} vehName={vehName} drvName={drvName} />}
      {tab === "procurement" && <ProcurementReports pos={fPos} grns={fGrns} poById={poById} />}
      {tab === "fleet" && <FleetReports trips={fTrips} vehicles={vehicles} vehName={vehName} />}
      {tab === "costs" && <CostReports trips={fTrips} dispById={dispById} vehName={vehName} expenses={fExpenses} orders={orders} />}
      {tab === "audit" && <AuditReport dispatches={fDispatches} trips={fTrips} pos={fPos} grns={fGrns} expenses={fExpenses} />}
    </div>
  );
}

function DeliveryReports({ dispatches, vehName, drvName }: { dispatches: DeliveryDispatch[]; vehName: Map<string, string>; drvName: Map<string, string> }) {
  const { t } = useLang();
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
      <Report title={t("Delivery status summary")} cols={[{ key: "status", label: t("Status") }, { key: "count", label: t("Dispatches"), align: "right" }]} rows={status} />
      <Report title={t("Delivery detail")} cols={[{ key: "ref", label: t("Ref") }, { key: "date", label: t("Date") }, { key: "vehicle", label: t("Vehicle") }, { key: "driver", label: t("Driver") }, { key: "stops", label: t("Stops"), align: "right" }, { key: "chicks", label: t("Chicks"), align: "right" }, { key: "delivered", label: t("Delivered"), align: "right" }, { key: "status", label: t("Status") }]} rows={detail} />
      <Report title={t("Failed deliveries")} cols={[{ key: "ref", label: t("Dispatch") }, { key: "date", label: t("Date") }, { key: "customer", label: t("Customer") }, { key: "product", label: t("Product") }, { key: "chicks", label: t("Chicks"), align: "right" }, { key: "reason", label: t("Reason") }]} rows={failed} />
      <Report title={t("Proof of delivery")} cols={[{ key: "ref", label: t("Dispatch") }, { key: "customer", label: t("Customer") }, { key: "product", label: t("Product") }, { key: "planned", label: t("Planned"), align: "right" }, { key: "delivered", label: t("Delivered"), align: "right" }, { key: "doa", label: t("DOA"), align: "right" }, { key: "pod", label: t("POD ref") }]} rows={pod} />
      <Report title={t("Delivery discrepancies")} note={t("Stops where the delivered quantity differed from what was dispatched.")} cols={[{ key: "ref", label: t("Dispatch") }, { key: "customer", label: t("Customer") }, { key: "planned", label: t("Planned"), align: "right" }, { key: "delivered", label: t("Delivered"), align: "right" }, { key: "short", label: t("Difference"), align: "right" }, { key: "outcome", label: t("Outcome") }]} rows={disc} />
    </div>
  );
}

function ProcurementReports({ pos, grns, poById }: { pos: PurchaseOrder[]; grns: GoodsReceipt[]; poById: Map<string, PurchaseOrder> }) {
  const { t } = useLang();
  const poRows = pos.map((p) => ({ ref: p.ref, supplier: p.supplierName, total: formatRWF(poTotal(p)), received: `${poReceivedQty(p.id, grns)} / ${poOrderedQty(p)}`, delivery: p.deliveryDate ? formatDate(p.deliveryDate) : "—", status: p.status }));
  const grnRows = grns.map((g) => { const m = threeWayMatch(poById.get(g.poId), g); return { ref: g.ref, po: g.poRef, supplier: g.supplierName, date: formatDate(g.receivedDate), accepted: formatRWF(grnAcceptedValue(g)), invoice: g.invoiceNo ?? "—", match: m.state, finance: g.handedToFinance ? t("handed off") : t("held") }; });
  const perf = useMemo(() => {
    const m = new Map<string, { pos: number; onTime: number; late: number }>();
    for (const g of grns) { const po = poById.get(g.poId); const g0 = m.get(g.supplierName) ?? { pos: 0, onTime: 0, late: 0 }; g0.pos += 1; if (po?.deliveryDate) { if (g.receivedDate <= po.deliveryDate) g0.onTime += 1; else g0.late += 1; } m.set(g.supplierName, g0); }
    return [...m.entries()].map(([supplier, v]) => ({ supplier, deliveries: v.pos, onTime: v.onTime, late: v.late }));
  }, [grns, poById]);
  return (
    <div className="space-y-5">
      <Report title={t("Purchase order status")} cols={[{ key: "ref", label: t("PO") }, { key: "supplier", label: t("Supplier") }, { key: "total", label: t("Total"), align: "right" }, { key: "received", label: t("Received") }, { key: "delivery", label: t("Delivery") }, { key: "status", label: t("Status") }]} rows={poRows} />
      <Report title={t("Goods received")} cols={[{ key: "ref", label: t("GRN") }, { key: "po", label: t("PO") }, { key: "supplier", label: t("Supplier") }, { key: "date", label: t("Date") }, { key: "accepted", label: t("Accepted value"), align: "right" }, { key: "invoice", label: t("Invoice") }, { key: "match", label: t("Match") }, { key: "finance", label: t("Finance") }]} rows={grnRows} />
      <Report title={t("Supplier delivery performance")} note={t("On-time = goods received on or before the PO delivery date.")} cols={[{ key: "supplier", label: t("Supplier") }, { key: "deliveries", label: t("Deliveries"), align: "right" }, { key: "onTime", label: t("On time"), align: "right" }, { key: "late", label: t("Late"), align: "right" }]} rows={perf} />
    </div>
  );
}

function FleetReports({ trips, vehicles, vehName }: { trips: Trip[]; vehicles: Vehicle[]; vehName: Map<string, string> }) {
  const { t: tr } = useLang();
  const usage = useMemo(() => {
    const m = new Map<string, { trips: number; km: number; fuel: number; cost: number }>();
    for (const t of trips) { if (t.status === "Cancelled") continue; const k = vehName.get(t.vehicleId ?? "") ?? tr("Unassigned"); const g = m.get(k) ?? { trips: 0, km: 0, fuel: 0, cost: 0 }; g.trips += 1; g.km += tripDistance(t); g.fuel += tripFuelLitres(t); g.cost += tripTotalCost(t); m.set(k, g); }
    return [...m.entries()].map(([vehicle, v]) => ({ vehicle, trips: v.trips, km: v.km.toLocaleString(), fuel: `${Math.round(v.fuel)} L`, cost: formatRWF(v.cost) }));
  }, [trips, vehName, tr]);
  const fuel = trips.filter((t) => tripFuelLitres(t) > 0).map((t) => { const c = tripConsumption(t); return { ref: t.ref, vehicle: vehName.get(t.vehicleId ?? "") ?? "—", km: tripDistance(t).toLocaleString(), litres: tripFuelLitres(t), l100: c.l100 || "—", cost: formatRWF(tripFuelCost(t)), flag: c.unusual ? tr("check") : "" }; });
  const today = new Date().toISOString().slice(0, 10);
  const docs = vehicles.filter((v) => v.active).map((v) => ({ plate: v.plate, insurance: v.insuranceExpiry ? `${formatDate(v.insuranceExpiry)} (${expiryState(v.insuranceExpiry, today)})` : "—", inspection: v.inspectionExpiry ? `${formatDate(v.inspectionExpiry)} (${expiryState(v.inspectionExpiry, today)})` : "—", availability: v.availability }));
  return (
    <div className="space-y-5">
      <Report title={tr("Vehicle usage")} cols={[{ key: "vehicle", label: tr("Vehicle") }, { key: "trips", label: tr("Trips"), align: "right" }, { key: "km", label: tr("Distance"), align: "right" }, { key: "fuel", label: tr("Fuel"), align: "right" }, { key: "cost", label: tr("Cost"), align: "right" }]} rows={usage} />
      <Report title={tr("Fuel consumption")} note={tr("Consumption in litres per 100 km; flagged for review when unusual.")} cols={[{ key: "ref", label: tr("Trip") }, { key: "vehicle", label: tr("Vehicle") }, { key: "km", label: tr("Distance"), align: "right" }, { key: "litres", label: tr("Litres"), align: "right" }, { key: "l100", label: tr("L/100km"), align: "right" }, { key: "cost", label: tr("Fuel cost"), align: "right" }, { key: "flag", label: tr("Flag") }]} rows={fuel} />
      <Report title={tr("Vehicle documents & maintenance")} cols={[{ key: "plate", label: tr("Vehicle") }, { key: "insurance", label: tr("Insurance") }, { key: "inspection", label: tr("Inspection") }, { key: "availability", label: tr("Status") }]} rows={docs} />
    </div>
  );
}

function CostReports({ trips, dispById, vehName, expenses, orders }: {
  trips: Trip[]; dispById: Map<string, DeliveryDispatch>; vehName: Map<string, string>; expenses: LogisticsExpense[]; orders: ReturnType<typeof useData>["orders"];
}) {
  const { t: tr } = useLang();
  const tripRows = trips.filter((t) => t.status !== "Cancelled").map((t) => { const m = tripMetrics(t, t.dispatchId ? dispById.get(t.dispatchId) : undefined); return { ref: t.ref, vehicle: vehName.get(t.vehicleId ?? "") ?? "—", km: m.distance.toLocaleString(), total: formatRWF(m.totalCost), perKm: m.costPerKm ? formatRWF(m.costPerKm) : "—", perChick: m.costPerChick ? formatRWF(m.costPerChick) : "—", allocation: t.allocation }; });
  const route = useMemo(() => {
    const m = new Map<string, { trips: number; cost: number; chicks: number }>();
    for (const t of trips) { if (t.status === "Cancelled") continue; const disp = t.dispatchId ? dispById.get(t.dispatchId) : undefined; const met = tripMetrics(t, disp); const k = t.route || "—"; const g = m.get(k) ?? { trips: 0, cost: 0, chicks: 0 }; g.trips += 1; g.cost += met.totalCost; g.chicks += met.chicks; m.set(k, g); }
    return [...m.entries()].map(([route, v]) => ({ route, trips: v.trips, chicks: v.chicks.toLocaleString(), cost: formatRWF(v.cost), perChick: v.chicks > 0 ? formatRWF(v.cost / v.chicks) : "—" }));
  }, [trips, dispById]);
  const exp = expenses.map((e) => ({ ref: e.ref, date: formatDate(e.date), category: e.category, payee: e.payee ?? "—", amount: formatRWF(e.amount), status: e.status, payment: e.paymentStatus ?? "—" }));
  return (
    <div className="space-y-5">
      <Report title={tr("Trip cost report")} note={tr("Per-chick figures come from the trip's linked delivery dispatch.")} cols={[{ key: "ref", label: tr("Trip") }, { key: "vehicle", label: tr("Vehicle") }, { key: "km", label: tr("Distance"), align: "right" }, { key: "total", label: tr("Total cost"), align: "right" }, { key: "perKm", label: tr("Cost/km"), align: "right" }, { key: "perChick", label: tr("Cost/chick"), align: "right" }, { key: "allocation", label: tr("Allocation") }]} rows={tripRows} />
      <Report title={tr("Route cost & profitability")} note={tr("Delivery cost per chick by route.")} cols={[{ key: "route", label: tr("Route") }, { key: "trips", label: tr("Trips"), align: "right" }, { key: "chicks", label: tr("Chicks"), align: "right" }, { key: "cost", label: tr("Cost"), align: "right" }, { key: "perChick", label: tr("Cost/chick"), align: "right" }]} rows={route} />
      <Report title={tr("Logistics expense report")} cols={[{ key: "ref", label: tr("Ref") }, { key: "date", label: tr("Date") }, { key: "category", label: tr("Category") }, { key: "payee", label: tr("Payee") }, { key: "amount", label: tr("Amount"), align: "right" }, { key: "status", label: tr("Status") }, { key: "payment", label: tr("Payment") }]} rows={exp} />
      <p className="text-xs text-muted">{tr("Orders on record:")} {orders.length.toLocaleString()} {tr("— route profitability compares delivery cost against the chicks actually delivered on each route.")}</p>
    </div>
  );
}

function AuditReport({ dispatches, trips, pos, grns, expenses }: {
  dispatches: DeliveryDispatch[]; trips: Trip[]; pos: PurchaseOrder[]; grns: GoodsReceipt[]; expenses: LogisticsExpense[];
}) {
  const { t: tr } = useLang();
  const rows = useMemo(() => {
    const out: { when: string; ref: string; entity: string; line: string }[] = [];
    const add = (entity: string, ref: string, history: string[]) => { for (const h of history ?? []) { const [iso, ...rest] = h.split(" · "); out.push({ when: iso, ref, entity, line: rest.join(" · ") }); } };
    dispatches.forEach((d) => add(tr("Dispatch"), d.ref, d.history));
    trips.forEach((t) => add(tr("Trip"), t.ref, t.history));
    pos.forEach((p) => add(tr("Purchase order"), p.ref, p.history));
    grns.forEach((g) => add(tr("Goods received"), g.ref, g.history));
    expenses.forEach((e) => add(tr("Expense"), e.ref, e.history));
    return out.sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 300)
      .map((r) => ({ when: r.when.replace("T", " ").slice(0, 16), entity: r.entity, ref: r.ref, line: r.line }));
  }, [dispatches, trips, pos, grns, expenses, tr]);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{tr("Every logistics record keeps an append-only history of who did what and when. Newest 300 actions across the module — completed records are never deleted; corrections are made through cancellations and reversals.")}</p>
      <Report title={tr("Logistics audit trail")} cols={[{ key: "when", label: tr("When") }, { key: "entity", label: tr("Record") }, { key: "ref", label: tr("Ref") }, { key: "line", label: tr("Action") }]} rows={rows} />
    </div>
  );
}
