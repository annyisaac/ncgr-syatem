"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatMoney } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { toDeliver, balance, isFullyPaid, type Order } from "@/lib/types";
import { listAgentQuotas, type AgentQuota } from "@/lib/quota";

const isActive = (s?: string) => s !== "refunded" && s !== "rejected";

export default function AgentOrdersPage() {
  const { user } = useAuth();
  const { orders } = useData();
  const [quotas, setQuotas] = useState<AgentQuota[]>([]);
  const email = (user?.email ?? "").toLowerCase();

  useEffect(() => {
    let active = true;
    listAgentQuotas().then((q) => { if (active) setQuotas(q); }).catch(() => { /* keep */ });
    return () => { active = false; };
  }, []);

  const mine = useMemo(
    () => orders.filter((o) => (o.by ?? "").toLowerCase() === email && o.product === "Ross 308").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [orders, email]
  );

  // Per-date quota usage (mine).
  const perDate = useMemo(() => {
    return quotas
      .filter((q) => q.agentEmail.toLowerCase() === email)
      .map((q) => {
        const sold = mine.filter((o) => o.date === q.date && isActive(o.status)).reduce((s, o) => s + toDeliver(o), 0);
        return { date: q.date, chicks: q.chicks, sold, left: Math.max(0, q.chicks - sold) };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [quotas, email, mine]);

  if (!user) return null;

  const totalOrders = mine.filter((o) => isActive(o.status)).length;
  const totalChicks = mine.filter((o) => isActive(o.status)).reduce((s, o) => s + o.chicks, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">My orders</h1>
          <p className="text-sm text-muted">Ross 308 orders you collected.</p>
        </div>
        <Link href="/agent"><Button size="sm">＋ New order</Button></Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="My orders" value={String(totalOrders)} />
        <StatTile label="Chicks ordered" value={totalChicks.toLocaleString()} tone="green" />
        <StatTile label="Delivery dates" value={String(perDate.length)} />
      </div>

      {perDate.length > 0 && (
        <Card>
          <CardHeader title="My quota by delivery date" />
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
        </Card>
      )}

      <Card>
        <CardHeader title={`Orders (${mine.length})`} />
        {mine.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No orders yet — tap “New order” to collect one.</p>
        ) : (
          <div className="space-y-2.5">
            {mine.map((o) => (
              <OrderCard key={o.id} o={o} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function OrderCard({ o }: { o: Order }) {
  const status = o.status === "rejected" ? "Rejected" : o.status === "refunded" ? "Refunded" : o.deliverOk ? "Delivered" : o.confirmedOk ? "Confirmed" : "Pending";
  const tone = o.status === "rejected" || o.status === "refunded" ? "red" : o.deliverOk ? "green" : o.confirmedOk ? "info" : "amber";
  return (
    <div className="rounded-2xl border border-line bg-paper p-3.5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{o.name}</p>
          <p className="text-xs text-muted">{o.phone} · {formatDate(o.date)}</p>
        </div>
        <Pill tone={tone}>{status}</Pill>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
        <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Chicks</p><p className="font-medium tabular-nums text-ink">{o.chicks.toLocaleString()}</p></div>
        <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Total</p><p className="font-medium tabular-nums text-ink">{formatMoney(o.chicks * o.price, o.currency ?? "RWF")}</p></div>
        <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Balance</p><p className={`font-medium tabular-nums ${isFullyPaid(o) ? "text-green" : "text-ink"}`}>{isFullyPaid(o) ? "Paid" : formatMoney(balance(o), o.currency ?? "RWF")}</p></div>
      </div>
    </div>
  );
}
