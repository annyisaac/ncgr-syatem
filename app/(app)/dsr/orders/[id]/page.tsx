"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";

import { balance, paidAmount, orderTotal, toDeliver } from "@/lib/types";
import { formatRWF } from "@/lib/config";
import { formatDate, formatDateTime } from "@/lib/format";
import { dsrAddPayment } from "@/lib/db";

const num = (v: string) => Number(v) || 0;

export default function DsrOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { orders, dsrs, reload } = useData();
  const { toast } = useToast();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);
  const order = useMemo(() => orders.find((o) => o.id === id), [orders, id]);

  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!user) return null;
  if (!order) {
    return (
      <div className="space-y-4">
        <Link href="/dsr/orders" className="text-sm text-gold-dark underline">← Back to orders</Link>
        <Card><p className="text-sm text-muted">Order not found in your zone.</p></Card>
      </div>
    );
  }

  const isMine = !!myDsr && order.dsrId === myDsr.id;
  const bal = balance(order);

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const amt = num(amount);
    if (amt <= 0) return setErr("Enter a valid amount.");
    if (!ref.trim()) return setErr("Enter the transaction ID / reference.");
    setSaving(true);
    const res = await dsrAddPayment(order!.id, amt, ref.trim());
    setSaving(false);
    if (!res.ok) return setErr(res.error ?? "Could not record the payment.");
    setAmount(""); setRef("");
    toast("Payment recorded — awaiting verification.");
    await reload();
  }

  return (
    <div className="space-y-5">
      <Link href="/dsr/orders" className="text-sm text-gold-dark underline">← Back to orders</Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">{order.name}</h1>
        <Pill tone={order.status === "fulfilled" ? "fulfilled" : order.status === "refunded" ? "refunded" : order.status === "rejected" ? "red" : "pending"}>
          {order.status}
        </Pill>
      </div>

      <Card>
        <CardHeader title="Order details" />
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Info label="Phone" value={order.phone} />
          <Info label="Product" value={order.product} />
          <Info label="District" value={order.clientDistrict || order.district} />
          <Info label="Sector" value={order.clientSector || order.sector} />
          <Info label="Delivery date" value={formatDate(order.date)} />
          <Info label="Chicks ordered" value={order.chicks.toLocaleString()} />
          <Info label="To deliver" value={toDeliver(order).toLocaleString()} />
          <Info label="Unit price" value={formatRWF(order.price)} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-md bg-ink/5 p-3 text-sm">
          <Info label="Total" value={formatRWF(orderTotal(order))} />
          <Info label="Paid" value={formatRWF(paidAmount(order))} />
          <Info label="Balance" value={formatRWF(bal)} />
        </div>
      </Card>

      {/* Payments */}
      <Card>
        <CardHeader title="Payments" />
        <TableWrap>
          <thead>
            <tr><Th>When</Th><Th className="text-right">Amount</Th><Th>Reference</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {order.payments.length === 0 ? (
              <EmptyRow colSpan={4} text="No payments yet." />
            ) : order.payments.map((p, i) => (
              <tr key={i}>
                <Td>{formatDateTime(p.on)}</Td>
                <Td className="text-right">{formatRWF(p.amt)}</Td>
                <Td>{p.ref || "—"}</Td>
                <Td>{p.verified ? <Pill tone="fulfilled">Verified</Pill> : <Pill tone="gold">Pending</Pill>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>

        {isMine ? (
          bal > 0 ? (
            <form onSubmit={addPayment} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <Field label="Amount (RWF)"><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Transaction ID"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="MTN / bank ref" /></Field>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Add payment"}</Button>
              {err && <p className="w-full text-sm text-status-refunded">{err}</p>}
            </form>
          ) : (
            <p className="mt-3 text-sm text-green">Fully paid.</p>
          )
        ) : (
          <p className="mt-3 text-xs text-muted">Only the DSR who owns this order can add payments.</p>
        )}
      </Card>

      {/* History — so the DSR sees any change a zone manager makes */}
      <Card>
        <CardHeader title="History & changes" />
        {order.history && order.history.length > 0 ? (
          <ol className="space-y-2 text-sm">
            {order.history.slice().reverse().map((h, i) => (
              <li key={i} className="flex gap-2 border-l-2 border-line pl-3 text-muted">
                <span className="text-ink">{h}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">No changes recorded yet.</p>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink/60">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}
