"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Kpi } from "@/components/dashboard/Kpi";
import { RecentActivity } from "@/components/RecentActivity";
import { todayISO } from "@/lib/format";

const TILES = [
  { href: "/dsr/order", label: "New order", hint: "Order chicks for a client" },
  { href: "/dsr/orders", label: "Zone orders", hint: "All orders in your zone" },
  { href: "/dsr/commission", label: "Commission", hint: "What you've earned" },
];

export default function DsrHome() {
  const { user } = useAuth();
  const { dsrs, orders } = useData();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);
  // Personal orders (drive the DSR's own monthly target).
  const myOrders = useMemo(() => (myDsr ? orders.filter((o) => o.dsrId === myDsr.id) : []), [orders, myDsr]);
  // Zone orders — the DSR sees everything in their zone (RLS already scopes to it).
  const zoneOrders = useMemo(() => (myDsr ? orders.filter((o) => o.zone === myDsr.zone) : []), [orders, myDsr]);

  if (!user) return null;
  if (!myDsr) {
    return <Card><p className="text-sm text-muted">Your DSR profile could not be found. Ask your zone manager.</p></Card>;
  }

  const month = todayISO().slice(0, 7);
  const myActive = myOrders.filter((o) => o.status !== "refunded" && o.status !== "rejected");
  const monthChicks = myActive.filter((o) => o.date.slice(0, 7) === month).reduce((s, o) => s + o.chicks, 0);
  const target = myDsr.monthlyTarget ?? 0;
  const pct = target > 0 ? Math.min(100, Math.round((monthChicks / target) * 100)) : 0;
  const zoneActive = zoneOrders.filter((o) => o.status !== "refunded" && o.status !== "rejected");
  const zoneChicks = zoneActive.reduce((s, o) => s + o.chicks, 0);

  return (
    <div className="space-y-6">
      <h1 className="section-heading text-2xl">Hello, {myDsr.name}</h1>

      {target > 0 && (
        <Card>
          <CardHeader title="This month's target" />
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2 text-sm">
            <span><strong className="text-ink">{monthChicks.toLocaleString()}</strong> <span className="text-muted">of {target.toLocaleString()} chicks</span></span>
            <span className={pct >= 100 ? "font-bold text-green" : "font-semibold text-gold-dark"}>{pct}%{pct >= 100 ? " — target met" : ` · ${Math.max(0, target - monthChicks).toLocaleString()} to go`}</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-grey-bg">
            <div className={`h-full rounded-full ${pct >= 100 ? "bg-green" : "bg-gold"}`} style={{ width: `${pct}%` }} />
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={`Orders in ${myDsr.zone}`} value={String(zoneActive.length)} icon="orders" />
        <Kpi label="Zone chicks" value={zoneChicks.toLocaleString()} icon="chicks" />
        <Kpi label="My chicks this month" value={monthChicks.toLocaleString()} tone="gold" icon="check" />
        <Kpi label="My orders" value={String(myActive.length)} icon="orders" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className="group flex min-h-[110px] flex-col justify-between rounded-2xl border border-line bg-paper p-5 shadow-card transition hover:-translate-y-0.5 hover:border-gold hover:shadow-pop">
            <span className="text-xl font-bold text-ink group-hover:text-gold-dark">{t.label}</span>
            <span className="text-sm text-muted">{t.hint}</span>
          </Link>
        ))}
      </div>

      <RecentActivity />
    </div>
  );
}
