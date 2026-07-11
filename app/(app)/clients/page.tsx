"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { Kpi } from "@/components/dashboard/Kpi";
import { visibleOrders } from "@/lib/permissions";
import { formatRWF } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { buildClients } from "@/lib/clients";

export default function ClientsPage() {
  const { user } = useAuth();
  const { orders } = useData();
  const [q, setQ] = useState("");

  const clients = useMemo(() => (user ? buildClients(visibleOrders(orders, user)) : []), [orders, user]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(s) || c.phone.toLowerCase().includes(s) || c.districts.some((d) => d.toLowerCase().includes(s)));
  }, [clients, q]);

  if (!user) return null;

  const totalChicks = clients.reduce((s, c) => s + c.chicks, 0);
  const totalBalance = clients.reduce((s, c) => s + c.balance, 0);

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Clients</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Clients" value={String(clients.length)} />
        <Kpi label="Chicks ordered" value={totalChicks.toLocaleString()} />
        <Kpi label="Outstanding balance" value={formatRWF(totalBalance)} tone={totalBalance > 0 ? "red" : "default"} />
        <Kpi label="Orders" value={String(clients.reduce((s, c) => s + c.ordersCount, 0))} />
      </div>

      <Card>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients — name, phone, district…" />
        <div className="mt-3">
          <TableWrap>
            <thead>
              <tr>
                <Th>Client</Th><Th>Phone</Th><Th>District(s)</Th>
                <Th className="text-right">Orders</Th><Th className="text-right">Chicks</Th>
                <Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Last order</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={8} text={q ? "No clients match." : "No clients yet."} />
              ) : filtered.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/clients/${encodeURIComponent(c.id)}`} className="font-medium text-gold-dark underline underline-offset-2">{c.name}</Link>
                  </Td>
                  <Td>{c.phone || "—"}</Td>
                  <Td>{c.districts.join(", ") || "—"}</Td>
                  <Td className="text-right">{c.ordersCount}</Td>
                  <Td className="text-right">{c.chicks.toLocaleString()}</Td>
                  <Td className="text-right">{formatRWF(c.paid)}</Td>
                  <Td className={`text-right ${c.balance > 0 ? "font-semibold text-red" : ""}`}>{formatRWF(c.balance)}</Td>
                  <Td>{c.lastOrder ? formatDate(c.lastOrder) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </Card>
    </div>
  );
}
