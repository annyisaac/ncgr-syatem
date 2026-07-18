"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { GreetingHeader, StatTile } from "@/components/dashboard/DashKit";
import { visibleOrders } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import type { Order } from "@/lib/types";

const KIND_LABEL: Record<string, string> = {
  refund: "Refund",
  compensation: "Compensation",
  debt: "Deliver on debt",
  edit: "Edit order",
};

const statusTone = (s: string) => (s === "approved" ? "green" : s === "rejected" ? "red" : "gold");

export default function RequestsPage() {
  const { user } = useAuth();
  const { orders } = useData();

  const isDsr = user?.role === "DSR";

  const rows = useMemo(() => {
    if (!user) return [];
    // DSRs see requests they raised (their orders are already RLS-scoped);
    // managers/admin see every request in their visible scope.
    const withReq = (isDsr
      ? orders.filter((o) => o.request && o.request.by === user.email)
      : visibleOrders(orders, user).filter((o) => o.request));
    return withReq.sort((a, b) => (a.request!.on < b.request!.on ? 1 : -1));
  }, [orders, user, isDsr]);

  if (!user) return null;

  const open = rows.filter((o) => o.request!.status === "open").length;
  const approved = rows.filter((o) => o.request!.status === "approved").length;
  const rejected = rows.filter((o) => o.request!.status === "rejected").length;

  const orderHref = (o: Order) => (isDsr ? `/dsr/orders/${o.id}` : `/orders?order=${encodeURIComponent(o.id)}`);

  return (
    <div className="space-y-5">
      <GreetingHeader name={user.name} subtitle={isDsr ? "here are your requests" : "requests from your team"} />

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Open" value={String(open)} tone={open ? "gold" : undefined} />
        <StatTile label="Approved" value={String(approved)} tone="green" />
        <StatTile label="Rejected" value={String(rejected)} tone={rejected ? "red" : undefined} />
      </div>

      <Card>
        <TableWrap>
          <thead>
            <tr>
              <Th>Requested</Th><Th>Client</Th><Th>Product</Th>
              <Th>Type</Th><Th>Reason</Th><Th>By</Th><Th>Status</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={8} text={isDsr ? "You have no requests." : "No requests from your team."} />
            ) : rows.map((o) => (
              <tr key={o.id}>
                <Td className="whitespace-nowrap text-muted">{formatDate(o.request!.on.slice(0, 10))}</Td>
                <Td className="font-medium">{o.name}</Td>
                <Td className="text-muted">{o.product}</Td>
                <Td>{KIND_LABEL[o.request!.kind] ?? o.request!.kind}</Td>
                <Td className="max-w-[16rem] text-sm text-muted">{o.request!.reason}</Td>
                <Td className="text-muted">{o.request!.by}</Td>
                <Td><Pill tone={statusTone(o.request!.status)}>{o.request!.status}</Pill></Td>
                <Td className="text-right">
                  <Link href={orderHref(o)} className="text-xs font-semibold text-gold-dark underline">Open</Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {!isDsr && <p className="mt-2 text-xs text-muted">Open requests are approved or rejected by the Admin from the order.</p>}
      </Card>
    </div>
  );
}
