"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Kpi } from "@/components/dashboard/Kpi";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { visibleOrders } from "@/lib/permissions";
import { formatRWF } from "@/lib/config";
import { formatDate, formatDateTime } from "@/lib/format";
import { clientById, clientPayments } from "@/lib/clients";
import { balance, paidAmount, orderTotal, toDeliver, type Order } from "@/lib/types";

function deliveryStatus(o: Order, routeName?: string): { label: string; tone: "green" | "gold" | "info" | "neutral" | "red" } {
  if (o.status === "refunded") return { label: "Refunded", tone: "red" };
  if (o.status === "rejected") return { label: "Rejected", tone: "red" };
  if (o.deliverOk) return { label: "Delivered", tone: "green" };
  if (o.routeId) return { label: routeName ? `On route: ${routeName}` : "On a route", tone: "info" };
  if (o.confirmedOk) return { label: "Confirmed", tone: "gold" };
  return { label: "Not confirmed", tone: "neutral" };
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { user } = useAuth();
  const { orders, routes } = useData();

  const client = useMemo(() => (user ? clientById(visibleOrders(orders, user), id) : undefined), [orders, user, id]);
  const routeName = (routeId?: string) => routes.find((r) => r.id === routeId)?.name;

  if (!user) return null;
  if (!client) {
    return (
      <div className="space-y-4">
        <Link href="/clients" className="text-sm text-gold-dark underline">← Back to clients</Link>
        <Card><p className="text-sm text-muted">Client not found.</p></Card>
      </div>
    );
  }

  const payments = clientPayments(client);
  const ordersSorted = client.orders.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const totalOrdered = client.orders.reduce((s, o) => s + orderTotal(o), 0);

  return (
    <div className="space-y-5">
      <Link href="/clients" className="text-sm text-gold-dark underline">← Back to clients</Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="section-heading text-lg">{client.name}</h1>
          <p className="text-sm text-muted">
            {client.phone || "no phone"}
            {client.districts.length ? ` · ${client.districts.join(", ")}` : ""}
            {client.sectors.length ? ` · ${client.sectors.join(", ")}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Orders" value={String(client.ordersCount)} />
        <Kpi label="Chicks ordered" value={client.chicks.toLocaleString()} />
        <Kpi label="To deliver" value={client.toDeliver.toLocaleString()} />
        <Kpi label="Order value" value={formatRWF(totalOrdered)} />
        <Kpi label="Paid" value={formatRWF(client.paid)} tone="green" />
        <Kpi label="Balance" value={formatRWF(client.balance)} tone={client.balance > 0 ? "red" : "default"} />
      </div>

      {/* Orders */}
      <Card>
        <CardHeader title={`Orders (${ordersSorted.length})`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Delivery date</Th><Th>Product</Th><Th className="text-right">Chicks</Th>
              <Th className="text-right">To deliver</Th><Th className="text-right">Total</Th>
              <Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {ordersSorted.length === 0 ? <EmptyRow colSpan={8} text="No orders." /> : ordersSorted.map((o) => {
              const st = deliveryStatus(o, routeName(o.routeId));
              return (
                <tr key={o.id}>
                  <Td>{formatDate(o.date)}</Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                  <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                  <Td className="text-right">{formatRWF(orderTotal(o))}</Td>
                  <Td className="text-right">{formatRWF(paidAmount(o))}</Td>
                  <Td className={`text-right ${balance(o) > 0 ? "font-semibold text-red" : ""}`}>{formatRWF(balance(o))}</Td>
                  <Td><Pill tone={st.tone}>{st.label}</Pill></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {/* Payments */}
      <Card>
        <CardHeader title={`Payments (${payments.length})`} />
        <TableWrap>
          <thead>
            <tr><Th>When</Th><Th>Product</Th><Th className="text-right">Amount</Th><Th>Reference</Th><Th>Verified</Th></tr>
          </thead>
          <tbody>
            {payments.length === 0 ? <EmptyRow colSpan={5} text="No payments recorded." /> : payments.map((p, i) => (
              <tr key={i}>
                <Td>{formatDateTime(p.on)}</Td>
                <Td>{p.product}</Td>
                <Td className="text-right">{formatRWF(p.amt)}</Td>
                <Td>{p.ref}</Td>
                <Td>{p.verified ? <Pill tone="green">Verified</Pill> : <Pill tone="gold">Pending</Pill>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
