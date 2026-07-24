"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { toDeliver, type Order } from "@/lib/types";
import { formatDate, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  expiryState, vehicleReady, listDrivers, listVehicles, type Driver, type Vehicle,
} from "@/lib/logistics";

const isClosed = (o: Order) => o.status === "refunded" || o.status === "rejected";
const isDelivered = (o: Order) => o.deliverOk || o.status === "fulfilled";
/** An order still needing a delivery: live, not yet delivered. */
const openForDelivery = (o: Order) => !isClosed(o) && !isDelivered(o);

export default function LogisticsDashboard() {
  const { user } = useAuth();
  const { orders } = useData();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);

  const canUse = user?.role === "Admin" || user?.role === "Logistics Officer";

  const load = useCallback(async () => {
    try { const [v, d] = await Promise.all([listVehicles(), listDrivers()]); setVehicles(v); setDrivers(d); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("logistics-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "vehicles" || p.table === "drivers") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
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

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for Logistics and Admin.</p></Card>;

  const firstName = user.name.split(" ")[0] || user.name;

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-ink">Hey {firstName} — <span className="font-normal text-muted">here&apos;s the delivery board</span></h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Deliveries today" value={String(todays.length)} />
        <StatTile label="Chicks today" value={todays.reduce((s, o) => s + toDeliver(o), 0).toLocaleString()} />
        <StatTile label="Overdue" value={String(overdue.length)} tone={overdue.length > 0 ? "red" : "default"} />
        <StatTile label="Failed / retry" value={String(failed.length)} tone={failed.length > 0 ? "gold" : "default"} />
        <StatTile label="Vehicles ready" value={String(readyVehicles)} tone="green" />
        <StatTile label="In maintenance" value={String(maintVehicles)} tone={maintVehicles > 0 ? "gold" : "default"} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming delivery days" action={<Link href="/planning" className="text-sm font-semibold text-gold-dark underline">Plan deliveries</Link>} />
          <TableWrap>
            <thead><tr><Th>Date</Th><Th className="text-right">Orders</Th><Th className="text-right">Chicks</Th><Th></Th></tr></thead>
            <tbody>
              {upcoming.length === 0 ? <EmptyRow colSpan={4} text="No upcoming deliveries scheduled." /> : upcoming.map(([date, g]) => (
                <tr key={date}>
                  <Td className="font-medium">{formatDate(date)}{date === today && <Pill tone="info" className="ml-2">Today</Pill>}</Td>
                  <Td className="text-right">{g.orders}</Td>
                  <Td className="text-right">{g.chicks.toLocaleString()}</Td>
                  <Td><Link href={`/planning?date=${date}`} className="text-sm text-gold-dark underline">Open</Link></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>

        <Card>
          <CardHeader title="Documents needing attention" />
          {expiringPapers.length === 0 && expiringLicences.length === 0 ? (
            <p className="text-sm text-muted">All vehicle papers and driver licences are current.</p>
          ) : (
            <div className="space-y-3">
              {expiringPapers.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{v.plate}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {expiryState(v.insuranceExpiry, today) !== "ok" && expiryState(v.insuranceExpiry, today) !== "unset" && <Pill tone={expiryState(v.insuranceExpiry, today) === "expired" ? "red" : "amber"}>Insurance {expiryState(v.insuranceExpiry, today)}</Pill>}
                    {expiryState(v.inspectionExpiry, today) !== "ok" && expiryState(v.inspectionExpiry, today) !== "unset" && <Pill tone={expiryState(v.inspectionExpiry, today) === "expired" ? "red" : "amber"}>Inspection {expiryState(v.inspectionExpiry, today)}</Pill>}
                  </span>
                </div>
              ))}
              {expiringLicences.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{d.name}</span>
                  <Pill tone={expiryState(d.licenceExpiry, today) === "expired" ? "red" : "amber"}>Licence {expiryState(d.licenceExpiry, today)}</Pill>
                </div>
              ))}
              <p className="pt-1 text-xs text-muted">Manage on <Link href="/logistics/vehicles" className="underline">Vehicles</Link> and <Link href="/logistics/drivers" className="underline">Drivers</Link>.</p>
            </div>
          )}
        </Card>
      </div>

      {overdue.length > 0 && (
        <Card className="border-red/40">
          <CardHeader title={`Overdue deliveries (${overdue.length})`} />
          <TableWrap>
            <thead><tr><Th>Delivery date</Th><Th>Customer</Th><Th>Product</Th><Th className="text-right">Chicks</Th><Th>District</Th><Th></Th></tr></thead>
            <tbody>
              {overdue.slice(0, 12).map((o) => (
                <tr key={o.id}>
                  <Td><span className="text-red">{formatDate(o.date)}</span></Td>
                  <Td className="font-medium">{o.name}<div className="text-xs text-muted">{o.phone}</div></Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                  <Td>{o.district}</Td>
                  <Td><Link href={`/orders/${o.id}`} className="text-sm text-gold-dark underline">View</Link></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      <p className="text-xs text-muted">Procurement, dispatch notes, trips, fuel and logistics expenses are coming to this workspace. For now, plan and track chick deliveries here and on the Deliveries calendar.</p>
    </div>
  );
}
