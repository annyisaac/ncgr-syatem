"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useLang } from "@/components/LanguageProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { toDeliver, type Order } from "@/lib/types";
import { formatDate, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  expiryState, vehicleReady, listDispatches, listDrivers, listVehicles,
  type DeliveryDispatch, type Driver, type Vehicle,
} from "@/lib/logistics";
import { listPurchaseOrders, listReceipts, poOrderedQty, poReceivedQty, type GoodsReceipt, type PurchaseOrder } from "@/lib/procurement";
import { listLogisticsExpenses, type LogisticsExpense } from "@/lib/logisticsOps";
import { formatRWF } from "@/lib/config";
import { listTrips, tripFuelLitres, type Trip } from "@/lib/trips";

const isClosed = (o: Order) => o.status === "refunded" || o.status === "rejected";
const isDelivered = (o: Order) => o.deliverOk || o.status === "fulfilled";
/** An order still needing a delivery: live, not yet delivered. */
const openForDelivery = (o: Order) => !isClosed(o) && !isDelivered(o);

export default function LogisticsDashboard() {
  const { user } = useAuth();
  const { orders } = useData();
  const { t } = useLang();
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [dispatches, setDispatches] = useState<DeliveryDispatch[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [grns, setGrns] = useState<GoodsReceipt[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [expenses, setExpenses] = useState<LogisticsExpense[]>([]);

  const canUse = user?.role === "Admin" || user?.role === "Logistics Officer";

  const load = useCallback(async () => {
    try {
      const [v, d, dp, p, g, t, e] = await Promise.all([listVehicles(), listDrivers(), listDispatches(), listPurchaseOrders(), listReceipts(), listTrips(), listLogisticsExpenses()]);
      setVehicles(v); setDrivers(d); setDispatches(dp); setPos(p); setGrns(g); setTrips(t); setExpenses(e);
    } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("logistics-live").on("postgres_changes", { event: "*", schema: "public" }, () => { if (t) clearTimeout(t); t = setTimeout(() => void load(), 500); }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const today = todayISO();

  const todays = useMemo(() => orders.filter((o) => o.date === today && openForDelivery(o)), [orders, today]);
  const overdue = useMemo(() => orders.filter((o) => o.date < today && openForDelivery(o)), [orders, today]);
  const failed = useMemo(() => orders.filter((o) => !!o.deliveryFail && openForDelivery(o)), [orders]);

  // Upcoming delivery days (today onward), with the box/chick load on each.
  const upcoming = useMemo(() => {
    const byDate = new Map<string, { orders: number; chicks: number }>();
    for (const o of orders) {
      if (o.date < today || !openForDelivery(o)) continue;
      const g = byDate.get(o.date) ?? { orders: 0, chicks: 0 };
      g.orders += 1; g.chicks += toDeliver(o);
      byDate.set(o.date, g);
    }
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, 8);
  }, [orders, today]);

  const readyVehicles = vehicles.filter((v) => vehicleReady(v, today)).length;
  const maintVehicles = vehicles.filter((v) => v.active && v.availability === "Under maintenance").length;
  const expiringPapers = vehicles.filter((v) => v.active && [v.insuranceExpiry, v.inspectionExpiry].some((d) => { const s = expiryState(d, today); return s === "soon" || s === "expired"; }));
  const expiringLicences = drivers.filter((d) => d.active && (() => { const s = expiryState(d.licenceExpiry, today); return s === "soon" || s === "expired"; })());

  // Cross-module KPIs (spec §21).
  const awaitingVehicle = useMemo(() => dispatches.filter((d) => ["Ready for Planning", "Scheduled"].includes(d.status)).length, [dispatches]);
  const inTransit = useMemo(() => dispatches.filter((d) => d.status === "Dispatched" || d.status === "In Transit").length, [dispatches]);
  const missingPod = useMemo(() => dispatches.filter((d) => (d.status === "Dispatched" || d.status === "In Transit") && d.stops.some((s) => !s.outcome || s.outcome === "pending")).length, [dispatches]);
  const openPOs = useMemo(() => pos.filter((p) => !["Cancelled", "Closed", "Fully Received"].includes(p.status)).length, [pos]);
  const overduePOs = useMemo(() => pos.filter((p) => p.deliveryDate && p.deliveryDate < today && !["Cancelled", "Closed", "Fully Received"].includes(p.status)).length, [pos, today]);
  const goodsAwaiting = useMemo(() => pos.filter((p) => ["Approved", "Sent to Supplier", "Partially Received"].includes(p.status) && poReceivedQty(p.id, grns) < poOrderedQty(p)).length, [pos, grns]);
  const fuelThisMonth = useMemo(() => Math.round(trips.filter((t) => (t.departAt ?? t.on).slice(0, 7) === today.slice(0, 7)).reduce((s, t) => s + tripFuelLitres(t), 0)), [trips, today]);
  const expensesAwaiting = useMemo(() => expenses.filter((e) => ["Submitted", "Verified", "Approved"].includes(e.status)).length, [expenses]);
  const expensesValue = useMemo(() => expenses.filter((e) => ["Submitted", "Verified", "Approved"].includes(e.status)).reduce((s, e) => s + e.amount, 0), [expenses]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">{t("This page is for Logistics and Admin.")}</p></Card>;

  const firstName = user.name.split(" ")[0] || user.name;

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-ink">{t("Hey")} {firstName} — <span className="font-normal text-muted">{t("here's the delivery board")}</span></h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label={t("Deliveries today")} value={String(todays.length)} />
        <StatTile label={t("Chicks today")} value={todays.reduce((s, o) => s + toDeliver(o), 0).toLocaleString()} />
        <StatTile label={t("Overdue")} value={String(overdue.length)} tone={overdue.length > 0 ? "red" : "default"} />
        <StatTile label={t("Failed / retry")} value={String(failed.length)} tone={failed.length > 0 ? "gold" : "default"} />
        <StatTile label={t("Vehicles ready")} value={String(readyVehicles)} tone="green" />
        <StatTile label={t("In maintenance")} value={String(maintVehicles)} tone={maintVehicles > 0 ? "gold" : "default"} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label={t("Awaiting vehicle")} value={String(awaitingVehicle)} tone={awaitingVehicle > 0 ? "gold" : "default"} onClick={() => router.push("/logistics/dispatch")} />
        <StatTile label={t("In transit")} value={String(inTransit)} tone={inTransit > 0 ? "gold" : "default"} onClick={() => router.push("/logistics/dispatch")} />
        <StatTile label={t("Missing proof")} value={String(missingPod)} tone={missingPod > 0 ? "red" : "default"} onClick={() => router.push("/logistics/dispatch")} />
        <StatTile label={t("Open POs")} value={String(openPOs)} onClick={() => router.push("/logistics/purchasing")} />
        <StatTile label={t("Overdue supplier")} value={String(overduePOs)} tone={overduePOs > 0 ? "red" : "default"} onClick={() => router.push("/logistics/purchasing")} />
        <StatTile label={t("Goods awaiting")} value={String(goodsAwaiting)} tone={goodsAwaiting > 0 ? "gold" : "default"} onClick={() => router.push("/logistics/purchasing")} />
        <StatTile label={t("Fuel this month")} value={`${fuelThisMonth.toLocaleString()} L`} onClick={() => router.push("/logistics/trips")} />
        <StatTile label={t("Expenses to approve")} value={String(expensesAwaiting)} tone={expensesAwaiting > 0 ? "gold" : "default"} onClick={() => router.push("/logistics/expenses")} />
        <StatTile label={t("Expense value pending")} value={formatRWF(expensesValue)} onClick={() => router.push("/logistics/expenses")} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("Upcoming delivery days")} action={<Link href="/planning" className="text-sm font-semibold text-gold-dark underline">{t("Plan deliveries")}</Link>} />
          <div className="hidden sm:block">
          <TableWrap>
            <thead><tr><Th>{t("Date")}</Th><Th className="text-right">{t("Orders")}</Th><Th className="text-right">{t("Chicks")}</Th><Th></Th></tr></thead>
            <tbody>
              {upcoming.length === 0 ? <EmptyRow colSpan={4} text={t("No upcoming deliveries scheduled.")} /> : upcoming.map(([date, g]) => (
                <tr key={date}>
                  <Td className="font-medium">{formatDate(date)}{date === today && <Pill tone="info" className="ml-2">{t("Today")}</Pill>}</Td>
                  <Td className="text-right">{g.orders}</Td>
                  <Td className="text-right">{g.chicks.toLocaleString()}</Td>
                  <Td><Link href={`/planning?date=${date}`} className="text-sm text-gold-dark underline">{t("Open")}</Link></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          </div>
          <div className="space-y-2 sm:hidden">
            {upcoming.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">{t("No upcoming deliveries scheduled.")}</p>
            ) : upcoming.map(([date, g]) => (
              <div key={date} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 shadow-card">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{formatDate(date)}{date === today && <Pill tone="info" className="ml-2">{t("Today")}</Pill>}</p>
                  <p className="text-xs text-muted">{g.orders} {t("Orders")} · {g.chicks.toLocaleString()} {t("Chicks")}</p>
                </div>
                <Link href={`/planning?date=${date}`} className="shrink-0 text-sm font-semibold text-gold-dark underline">{t("Open")}</Link>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Documents needing attention")} />
          {expiringPapers.length === 0 && expiringLicences.length === 0 ? (
            <p className="text-sm text-muted">{t("All vehicle papers and driver licences are current.")}</p>
          ) : (
            <div className="space-y-3">
              {expiringPapers.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{v.plate}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {expiryState(v.insuranceExpiry, today) !== "ok" && expiryState(v.insuranceExpiry, today) !== "unset" && <Pill tone={expiryState(v.insuranceExpiry, today) === "expired" ? "red" : "amber"}>{t("Insurance")} {expiryState(v.insuranceExpiry, today)}</Pill>}
                    {expiryState(v.inspectionExpiry, today) !== "ok" && expiryState(v.inspectionExpiry, today) !== "unset" && <Pill tone={expiryState(v.inspectionExpiry, today) === "expired" ? "red" : "amber"}>{t("Inspection")} {expiryState(v.inspectionExpiry, today)}</Pill>}
                  </span>
                </div>
              ))}
              {expiringLicences.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{d.name}</span>
                  <Pill tone={expiryState(d.licenceExpiry, today) === "expired" ? "red" : "amber"}>{t("Licence")} {expiryState(d.licenceExpiry, today)}</Pill>
                </div>
              ))}
              <p className="pt-1 text-xs text-muted">{t("Manage on")} <Link href="/logistics/vehicles" className="underline">{t("Vehicles")}</Link> {t("and")} <Link href="/logistics/drivers" className="underline">{t("Drivers")}</Link>.</p>
            </div>
          )}
        </Card>
      </div>

      {overdue.length > 0 && (
        <Card className="border-red/40">
          <CardHeader title={`${t("Overdue deliveries")} (${overdue.length})`} />
          <div className="hidden sm:block">
          <TableWrap>
            <thead><tr><Th>{t("Delivery date")}</Th><Th>{t("Customer")}</Th><Th>{t("Product")}</Th><Th className="text-right">{t("Chicks")}</Th><Th>{t("District")}</Th><Th></Th></tr></thead>
            <tbody>
              {overdue.slice(0, 12).map((o) => (
                <tr key={o.id}>
                  <Td><span className="text-red">{formatDate(o.date)}</span></Td>
                  <Td className="font-medium">{o.name}<div className="text-xs text-muted">{o.phone}</div></Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                  <Td>{o.district}</Td>
                  <Td><Link href={`/orders/${o.id}`} className="text-sm text-gold-dark underline">{t("View")}</Link></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          </div>
          <div className="space-y-2.5 sm:hidden">
            {overdue.slice(0, 12).map((o) => (
              <div key={o.id} className="rounded-2xl border border-line bg-paper p-3.5 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{o.name}</p>
                    <p className="text-xs text-muted">{o.phone}</p>
                  </div>
                  <Link href={`/orders/${o.id}`} className="shrink-0 text-sm font-semibold text-gold-dark underline">{t("View")}</Link>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{t("Delivery date")}</p><p className="font-medium text-red">{formatDate(o.date)}</p></div>
                  <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{t("Product")}</p><p className="font-medium text-ink">{o.product}</p></div>
                  <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{t("Chicks")}</p><p className="font-medium tabular-nums text-ink">{toDeliver(o).toLocaleString()}</p></div>
                  <div className="min-w-0"><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{t("District")}</p><p className="truncate font-medium text-ink">{o.district}</p></div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-xs text-muted">{t("Procurement, dispatch notes, trips, fuel and logistics expenses are coming to this workspace. For now, plan and track chick deliveries here and on the Deliveries calendar.")}</p>
    </div>
  );
}
