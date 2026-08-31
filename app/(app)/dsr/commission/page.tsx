"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Kpi } from "@/components/dashboard/Kpi";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { formatRWF } from "@/lib/config";
import { formatDate, todayISO } from "@/lib/format";
import { isCommissionEligible, orderCommission, commissionChicks } from "@/lib/commission";

/** "2026-08" → "August 2026" */
function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export default function DsrCommissionPage() {
  const { user } = useAuth();
  const { dsrs, orders } = useData();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);
  const eligible = useMemo(
    () => (myDsr ? orders.filter((o) => o.dsrId === myDsr.id && isCommissionEligible(o)).sort((a, b) => (a.date < b.date ? 1 : -1)) : []),
    [orders, myDsr]
  );

  // Months that actually have commission, newest first, plus an all-time view.
  const months = useMemo(
    () => Array.from(new Set(eligible.map((o) => o.date.slice(0, 7)))).sort().reverse(),
    [eligible]
  );
  const [month, setMonth] = useState<string>("all");
  const myOrders = useMemo(
    () => (month === "all" ? eligible : eligible.filter((o) => o.date.slice(0, 7) === month)),
    [eligible, month]
  );

  if (!user) return null;
  if (!myDsr) return <Card><p className="text-sm text-muted">Your DSR profile could not be found.</p></Card>;

  const total = myOrders.reduce((s, o) => s + orderCommission(o), 0);
  const paid = myOrders.filter((o) => o.commPaid).reduce((s, o) => s + orderCommission(o), 0);
  const pending = total - paid;
  const chicks = myOrders.reduce((s, o) => s + commissionChicks(o), 0);
  // What this month is worth so far, whatever period is on screen above.
  const thisMonth = eligible
    .filter((o) => o.date.slice(0, 7) === todayISO().slice(0, 7))
    .reduce((s, o) => s + orderCommission(o), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Commission is earned once an order is delivered or paid in full — {formatRWF(thisMonth)} so far this month.
        </p>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-10 rounded-lg border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-gold"
        >
          <option value="all">All time</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total earned" value={formatRWF(total)} icon="money" compact />
        <Kpi label="Paid to me" value={formatRWF(paid)} tone="green" icon="check" compact />
        <Kpi label="Pending" value={formatRWF(pending)} tone={pending > 0 ? "gold" : "default"} icon="pending" compact />
        <Kpi label="Chicks counted" value={chicks.toLocaleString()} icon="chicks" compact />
      </div>

      <Card>
        <CardHeader title={`Commission by order${month === "all" ? "" : ` · ${monthLabel(month)}`}`} />
        <TableWrap>
          <thead>
            <tr><Th>Delivery date</Th><Th>Client</Th><Th>Product</Th><Th className="text-right">Chicks</Th><Th className="text-right">Commission</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {myOrders.length === 0 ? <EmptyRow colSpan={6} text="No commission-eligible orders yet." /> : myOrders.map((o) => (
              <tr key={o.id}>
                <Td>{formatDate(o.date)}</Td>
                <Td className="font-medium">{o.name}</Td>
                <Td className="text-muted">{o.product}</Td>
                <Td className="text-right">{commissionChicks(o).toLocaleString()}</Td>
                <Td className="text-right font-semibold">{formatRWF(orderCommission(o))}</Td>
                <Td>{o.commPaid ? <Pill tone="fulfilled">Paid</Pill> : o.commReq ? <Pill tone="gold">Initiated</Pill> : <Pill tone="neutral">Not yet</Pill>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
