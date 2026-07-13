"use client";

import { useMemo } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { formatRWF } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { balance, paidAmount, toDeliver, type Order } from "@/lib/types";

function track(o: Order): { label: string; tone: "green" | "gold" | "info" | "neutral" | "red" } {
  if (o.status === "refunded") return { label: "Refunded", tone: "red" };
  if (o.status === "rejected") return { label: "Rejected", tone: "red" };
  if (o.deliverOk) return { label: "Delivered", tone: "green" };
  if (o.routeId) return { label: "On the truck", tone: "info" };
  if (o.confirmedOk) return { label: "Confirmed — awaiting delivery", tone: "gold" };
  return { label: "Awaiting payment", tone: "neutral" };
}

export default function DsrOrdersPage() {
  const { user } = useAuth();
  const { dsrs, orders } = useData();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);
  // Every order in the DSR's zone (RLS already scopes the data to their zone).
  const zoneOrders = useMemo(
    () => (myDsr ? orders.filter((o) => o.zone === myDsr.zone).sort((a, b) => (a.date < b.date ? 1 : -1)) : []),
    [orders, myDsr]
  );

  if (!user) return null;
  if (!myDsr) return <Card><p className="text-sm text-muted">Your DSR profile could not be found.</p></Card>;

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Orders in {myDsr.zone}</h1>
      <Card>
        <CardHeader title={`${zoneOrders.length} order(s) in your zone`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Delivery date</Th><Th>Client</Th><Th>DSR</Th><Th>Product</Th>
              <Th className="text-right">Chicks</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {zoneOrders.length === 0 ? <EmptyRow colSpan={8} text="No orders in your zone yet." /> : zoneOrders.map((o) => {
              const t = track(o);
              return (
                <tr key={o.id}>
                  <Td>{formatDate(o.date)}</Td>
                  <Td className="font-medium">{o.name} <span className="text-xs text-muted">· {o.phone}</span></Td>
                  <Td className="text-muted">{o.dsr ?? "—"}</Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                  <Td className="text-right">{formatRWF(paidAmount(o))}</Td>
                  <Td className={`text-right ${balance(o) > 0 ? "font-semibold text-red" : ""}`}>{formatRWF(balance(o))}</Td>
                  <Td><Pill tone={t.tone}>{t.label}</Pill></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
