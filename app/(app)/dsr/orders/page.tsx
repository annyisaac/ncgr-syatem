"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { formatRWF } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { balance, paidAmount, toDeliver } from "@/lib/types";
import { orderStage } from "@/lib/orders";

export default function DsrOrdersPage() {
  const { user } = useAuth();
  const { dsrs, orders } = useData();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);
  // Every order in the DSR's zone (RLS already scopes the data to their zone).
  const zoneOrders = useMemo(
    () => (myDsr ? orders.filter((o) => o.zone === myDsr.zone).sort((a, b) => (a.date < b.date ? 1 : -1)) : []),
    [orders, myDsr]
  );

  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return zoneOrders;
    const digits = s.replace(/\D/g, "");
    return zoneOrders.filter((o) =>
      o.name.toLowerCase().includes(s) ||
      (digits !== "" && o.phone.replace(/\D/g, "").includes(digits)) ||
      (o.dsr ?? "").toLowerCase().includes(s)
    );
  }, [zoneOrders, q]);

  if (!user) return null;
  if (!myDsr) return <Card><p className="text-sm text-muted">Your DSR profile could not be found.</p></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Orders in {myDsr.zone}</h1>
        <Link href="/dsr/order" className="rounded-[10px] bg-gold px-4 py-2.5 text-[0.82rem] font-bold text-[#231b04] transition hover:brightness-[1.05]">
          + New order
        </Link>
      </div>
      <Card>
        <CardHeader title={`${shown.length} order(s) in your zone`} />
        <div className="mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by client name or phone…"
            className="w-full rounded-[9px] border border-line bg-field px-3.5 py-2.5 text-[0.9rem] text-ink focus:outline-none focus-visible:border-gold"
          />
        </div>
        <TableWrap>
          <thead>
            <tr>
              <Th>Delivery date</Th><Th>Client</Th><Th>DSR</Th><Th>Product</Th>
              <Th className="text-right">Chicks</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Status</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? <EmptyRow colSpan={9} text="No matching orders." /> : shown.map((o) => {
              const t = orderStage(o);
              return (
                <tr key={o.id} className="cursor-pointer hover:bg-gold-bg">
                  <Td>{formatDate(o.date)}</Td>
                  <Td className="font-medium">
                    <Link href={`/dsr/orders/${o.id}`} className="text-gold-dark underline underline-offset-2">{o.name}</Link>
                    {" "}<span className="text-xs text-muted">· {o.phone}</span>
                  </Td>
                  <Td className="text-muted">{o.dsr ?? "—"}</Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                  <Td className="text-right">{formatRWF(paidAmount(o))}</Td>
                  <Td className={`text-right ${balance(o) > 0 ? "font-semibold text-red" : ""}`}>{formatRWF(balance(o))}</Td>
                  <Td><Pill tone={t.tone}>{t.label}</Pill></Td>
                  <Td>
                    <Link href={`/dsr/orders/${o.id}`} className="inline-block rounded-md border border-line px-2.5 py-1 text-[0.72rem] font-semibold text-ink transition hover:border-gold hover:bg-gold-bg">
                      Manage
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
