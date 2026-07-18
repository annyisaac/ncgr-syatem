"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card } from "@/components/ui/Card";
import { GreetingHeader, StatTile, SectionTitle } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { balance, toDeliver } from "@/lib/types";
import { formatDate, todayISO } from "@/lib/format";

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
  const [q, setQ] = useState("");

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

  const s = q.trim().toLowerCase();
  const digits = s.replace(/\D/g, "");
  const results = s
    ? zoneOrders.filter((o) => o.name.toLowerCase().includes(s) || (digits !== "" && o.phone.replace(/\D/g, "").includes(digits))).slice(0, 8)
    : [];

  return (
    <div className="space-y-5">
      <GreetingHeader name={myDsr.name} subtitle={`here's your ${myDsr.zone} today`} />

      {/* Search the zone's orders/customers */}
      <Card>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a customer by name or phone…"
          className="w-full rounded-full border border-line bg-field px-4 py-2.5 text-[0.95rem] text-ink focus:outline-none focus-visible:border-gold"
        />
        {s && (
          <div className="mt-3 space-y-1.5">
            {results.length === 0 ? (
              <p className="text-sm text-muted">No matching customers in your zone.</p>
            ) : results.map((o) => (
              <Link key={o.id} href={`/dsr/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm transition hover:border-gold hover:bg-gold-bg">
                <span><strong className="text-ink">{o.name}</strong> <span className="text-muted">· {o.phone} · {formatDate(o.date)}</span></span>
                <span className="text-muted">{toDeliver(o).toLocaleString()} chicks · <span className={balance(o) > 0 ? "font-semibold text-red" : "text-green"}>{formatRWF(balance(o))}</span></span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={`Orders in ${myDsr.zone}`} value={String(zoneActive.length)} />
        <StatTile label="Zone chicks" value={zoneChicks.toLocaleString()} />
        <StatTile label="My chicks this month" value={monthChicks.toLocaleString()} tone="gold" />
        <StatTile label="My orders" value={String(myActive.length)} />
      </div>

      {target > 0 && (
        <Card>
          <SectionTitle label="This month's target" />
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2 text-sm">
            <span><strong className="text-ink">{monthChicks.toLocaleString()}</strong> <span className="text-muted">of {target.toLocaleString()} chicks</span></span>
            <span className={pct >= 100 ? "font-bold text-green" : "font-semibold text-gold-dark"}>{pct}%{pct >= 100 ? " — target met" : ` · ${Math.max(0, target - monthChicks).toLocaleString()} to go`}</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-grey-bg">
            <div className={`h-full rounded-full ${pct >= 100 ? "bg-green" : "bg-gold"}`} style={{ width: `${pct}%` }} />
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className="group flex min-h-[110px] flex-col justify-between rounded-2xl border border-line bg-paper p-5 shadow-card transition hover:-translate-y-0.5 hover:border-gold hover:shadow-pop">
            <span className="text-xl font-bold text-ink group-hover:text-gold-dark">{t.label}</span>
            <span className="text-sm text-muted">{t.hint}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
