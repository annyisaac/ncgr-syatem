"use client";

import { useMemo } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Kpi } from "@/components/dashboard/Kpi";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { formatRWF } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { isCommissionEligible, orderCommission } from "@/lib/commission";

export default function DsrCommissionPage() {
  const { user } = useAuth();
  const { dsrs, orders } = useData();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);
  const myOrders = useMemo(
    () => (myDsr ? orders.filter((o) => o.dsrId === myDsr.id && isCommissionEligible(o)).sort((a, b) => (a.date < b.date ? 1 : -1)) : []),
    [orders, myDsr]
  );

  if (!user) return null;
  if (!myDsr) return <Card><p className="text-sm text-muted">Your DSR profile could not be found.</p></Card>;

  const total = myOrders.reduce((s, o) => s + orderCommission(o), 0);
  const paid = myOrders.filter((o) => o.commPaid).reduce((s, o) => s + orderCommission(o), 0);
  const pending = total - paid;

  return (
    <div className="space-y-5">

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Total earned" value={formatRWF(total)} />
        <Kpi label="Paid to me" value={formatRWF(paid)} tone="green" />
        <Kpi label="Pending" value={formatRWF(pending)} tone={pending > 0 ? "gold" : "default"} />
      </div>

      <Card>
        <CardHeader title="Commission by order" />
        <TableWrap>
          <thead>
            <tr><Th>Delivery date</Th><Th>Client</Th><Th className="text-right">Chicks</Th><Th className="text-right">Commission</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {myOrders.length === 0 ? <EmptyRow colSpan={5} text="No commission-eligible orders yet." /> : myOrders.map((o) => (
              <tr key={o.id}>
                <Td>{formatDate(o.date)}</Td>
                <Td className="font-medium">{o.name}</Td>
                <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(orderCommission(o))}</Td>
                <Td>{o.commPaid ? <Pill tone="fulfilled">Paid</Pill> : o.commReq ? <Pill tone="gold">Initiated</Pill> : <Pill tone="neutral">Not yet</Pill>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
