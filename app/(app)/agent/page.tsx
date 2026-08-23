"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatMoney } from "@/lib/config";
import { formatDate, todayISO } from "@/lib/format";
import { toDeliver, isFullyPaid, balance } from "@/lib/types";
import { listAgentQuotas, type AgentQuota } from "@/lib/quota";

const isActive = (s?: string) => s !== "refunded" && s !== "rejected";

export default function AgentDashboardPage() {
  const { user } = useAuth();
  const { orders } = useData();
  const [quotas, setQuotas] = useState<AgentQuota[]>([]);
  const email = (user?.email ?? "").toLowerCase();

  useEffect(() => {
    let active = true;
    listAgentQuotas().then((q) => { if (active) setQuotas(q); }).catch(() => { /* keep */ });
    return () => { active = false; };
  }, []);

  const mine = useMemo(() => orders.filter((o) => (o.by ?? "").toLowerCase() === email && o.product === "Ross 308"), [orders, email]);
  const active = mine.filter((o) => isActive(o.status));

  const perDate = useMemo(() => {
    const today = todayISO();
    return quotas
      .filter((q) => q.agentEmail.toLowerCase() === email && q.date >= today)
      .map((q) => {
        const sold = active.filter((o) => o.date === q.date).reduce((s, o) => s + toDeliver(o), 0);
        return { date: q.date, chicks: q.chicks, sold, left: Math.max(0, q.chicks - sold) };
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [quotas, email, active]);

  if (!user) return null;

  const totalLeft = perDate.reduce((s, d) => s + d.left, 0);
  const chicksSold = active.reduce((s, o) => s + o.chicks, 0);
  // Rejected payments across the agent's orders — a nudge to re-collect.
  const rejectedPayments = mine.reduce((n, o) => n + o.payments.filter((p) => p.voided).length, 0);
  const recent = mine.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">Hello {user.name} 👋</h1>
        <p className="text-sm text-muted">Your Ross 308 field sales at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Chicks left to sell" value={totalLeft.toLocaleString()} tone={totalLeft > 0 ? "green" : "default"} />
        <StatTile label="My orders" value={String(active.length)} />
        <StatTile label="Chicks sold" value={chicksSold.toLocaleString()} />
        <StatTile label="Rejected payments" value={String(rejectedPayments)} tone={rejectedPayments > 0 ? "red" : "default"} />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Link href="/agent/order" className="rounded-2xl border border-line bg-paper p-4 text-center shadow-card transition hover:border-gold">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-gold-bg text-gold-dark"><IcoPlus /></span>
          <p className="mt-2 text-sm font-semibold text-ink">New order</p>
        </Link>
        <Link href="/agent/orders" className="rounded-2xl border border-line bg-paper p-4 text-center shadow-card transition hover:border-gold">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-blue-bg text-blue"><IcoList /></span>
          <p className="mt-2 text-sm font-semibold text-ink">My orders {rejectedPayments > 0 && <span className="text-red">· {rejectedPayments} to re-collect</span>}</p>
        </Link>
        <Link href="/agent/orders#report" className="rounded-2xl border border-line bg-paper p-4 text-center shadow-card transition hover:border-gold">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-green-bg text-green"><IcoReport /></span>
          <p className="mt-2 text-sm font-semibold text-ink">Report</p>
        </Link>
      </div>

      {rejectedPayments > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-red/30 bg-red-bg/60 p-4 shadow-card">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-bg font-bold text-red">!</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{rejectedPayments} payment{rejectedPayments === 1 ? "" : "s"} rejected</p>
            <p className="text-xs text-muted">Re-collect the money and add the new payment on the order in <Link href="/agent/orders" className="text-gold-dark underline">My orders</Link>.</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader title="My quota by delivery date" />
        {perDate.length === 0 ? (
          <p className="text-sm text-muted">No upcoming quota. Ask the Admin to allocate you chicks for a delivery date.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {perDate.map((d) => (
              <div key={d.date} className="rounded-xl border border-line bg-paper p-3 shadow-card">
                <p className="font-semibold text-ink">{formatDate(d.date)}</p>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-muted">Sold {d.sold.toLocaleString()} / {d.chicks.toLocaleString()}</span>
                  <Pill tone={d.left > 0 ? "green" : "neutral"}>{d.left.toLocaleString()} left</Pill>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent orders" action={<Link href="/agent/orders" className="text-xs font-semibold text-gold-dark underline">View all</Link>} />
        {recent.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No orders yet.</p>
        ) : (
          <div className="space-y-2">
            {recent.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="min-w-0"><b className="text-ink">{o.name}</b> <span className="text-muted">· {formatDate(o.date)} · {o.chicks.toLocaleString()} chicks</span></span>
                <span className={isFullyPaid(o) ? "text-green" : "text-muted"}>{isFullyPaid(o) ? "Paid" : formatMoney(balance(o), o.currency ?? "RWF") + " left"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const svg = (children: React.ReactNode) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
const IcoPlus = () => svg(<><path d="M12 5v14M5 12h14" /></>);
const IcoList = () => svg(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>);
const IcoReport = () => svg(<><path d="M4 4h11l5 5v11a0 0 0 0 1 0 0H4z" /><path d="M14 4v5h5M8 13h8M8 17h5" /></>);
