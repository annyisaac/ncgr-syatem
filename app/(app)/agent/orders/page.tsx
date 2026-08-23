"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatMoney } from "@/lib/config";
import { formatDate, formatDateTime, nowISO, isValidMomoRef } from "@/lib/format";
import { toDeliver, balance, isFullyPaid, paidAmount, orderTotal, type Order, type Payment } from "@/lib/types";
import { uploadPaymentSlip } from "@/lib/db";
import { listAgentQuotas, agentAddPayment, type AgentQuota } from "@/lib/quota";

const isActive = (s?: string) => s !== "refunded" && s !== "rejected";
const num = (v: string) => Number(v) || 0;

export default function AgentOrdersPage() {
  const { user } = useAuth();
  const { orders, reload } = useData();
  const { toast } = useToast();
  const [quotas, setQuotas] = useState<AgentQuota[]>([]);
  const email = (user?.email ?? "").toLowerCase();

  // Add-payment modal
  const [payFor, setPayFor] = useState<Order | null>(null);
  const [amt, setAmt] = useState("");
  const [ref, setRef] = useState("");
  const [method, setMethod] = useState<"MoMo" | "Bank">("MoMo");
  const [bankName, setBankName] = useState("");
  const [slip, setSlip] = useState<File | null>(null);
  const [perr, setPerr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    listAgentQuotas().then((q) => { if (active) setQuotas(q); }).catch(() => { /* keep */ });
    return () => { active = false; };
  }, []);

  const mine = useMemo(
    () => orders.filter((o) => (o.by ?? "").toLowerCase() === email && o.product === "Ross 308").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [orders, email]
  );
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

  function openPay(o: Order) {
    setPayFor(o); setAmt(""); setRef(""); setMethod("MoMo"); setBankName(""); setSlip(null); setPerr(null);
  }

  async function savePayment() {
    if (!payFor) return;
    setPerr(null);
    const n = num(amt);
    if (n <= 0) return setPerr("Enter the amount collected.");
    if (!ref.trim()) return setPerr("Enter the transaction ID.");
    if (method === "MoMo" && !isValidMomoRef(ref)) return setPerr("MoMo transaction ID must be exactly 11 digits.");
    if (method === "Bank" && !bankName.trim()) return setPerr("Enter the bank name.");
    if (method === "Bank" && !slip) return setPerr("Upload the bank payment slip.");
    setSaving(true);
    let slipPath: string | undefined;
    if (method === "Bank" && slip) {
      try { slipPath = await uploadPaymentSlip(slip); }
      catch (e) { setSaving(false); return setPerr(e instanceof Error ? e.message : "Could not upload the slip."); }
    }
    const payment: Payment = { amt: n, ref: ref.trim(), on: nowISO(), by: user!.email, method, ...(method === "Bank" ? { bankName: bankName.trim() } : {}), ...(slipPath ? { slipPath } : {}), verified: false };
    const res = await agentAddPayment(payFor.id, payment);
    setSaving(false);
    if (!res.ok) return setPerr(res.error ?? "Could not save the payment.");
    toast(`Payment of ${n.toLocaleString()} recorded for ${payFor.name}.`);
    setPayFor(null);
    void reload();
  }

  function downloadReport() {
    if (mine.length === 0) return toast("No orders to export.", "info");
    const head = ["Created", "Delivery date", "Customer", "Phone", "District", "Chicks", "Total", "Paid", "Balance", "Status"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const statusOf = (o: Order) => o.status === "rejected" ? "Rejected" : o.status === "refunded" ? "Refunded" : o.deliverOk ? "Delivered" : o.confirmedOk ? "Confirmed" : "Pending";
    const lines = [head.map(esc).join(",")];
    for (const o of mine) {
      lines.push([
        formatDate(o.createdAt.slice(0, 10)), formatDate(o.date), o.name, o.phone, o.district ?? "",
        String(o.chicks), String(orderTotal(o)), String(paidAmount(o)), String(balance(o)), statusOf(o),
      ].map((v) => esc(String(v))).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "my-ross-orders.csv"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">My orders</h1>
          <p className="text-sm text-muted">Ross 308 orders you collected.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={downloadReport}>⬇ Report (CSV)</Button>
          <Link href="/agent/order"><Button size="sm">＋ New order</Button></Link>
        </div>
      </div>

      <div id="report" className="grid grid-cols-2 gap-3 sm:grid-cols-4 scroll-mt-24">
        <StatTile label="My orders" value={String(totalOrders)} />
        <StatTile label="Chicks ordered" value={totalChicks.toLocaleString()} tone="green" />
        <StatTile label="Collected" value={formatMoney(mine.filter((o) => isActive(o.status)).reduce((s, o) => s + paidAmount(o), 0), "RWF")} />
        <StatTile label="Outstanding" value={formatMoney(mine.filter((o) => isActive(o.status)).reduce((s, o) => s + balance(o), 0), "RWF")} tone="gold" />
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
            {mine.map((o) => <OrderCard key={o.id} o={o} onAddPayment={() => openPay(o)} />)}
          </div>
        )}
      </Card>

      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={payFor ? `Add payment — ${payFor.name}` : ""}
        footer={<><Button variant="ghost" onClick={() => setPayFor(null)}>Cancel</Button><Button onClick={savePayment} disabled={saving}>{saving ? "Saving…" : "Record payment"}</Button></>}>
        {payFor && (
          <div className="space-y-4">
            <p className="text-sm text-muted">Balance on this order: <b className="text-ink">{formatMoney(balance(payFor), payFor.currency ?? "RWF")}</b></p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Payment method"><Select value={method} onChange={(e) => setMethod(e.target.value as "MoMo" | "Bank")} options={[{ value: "MoMo", label: "Mobile Money (MoMo)" }, { value: "Bank", label: "Bank transfer" }]} /></Field>
              <Field label={`Amount (${payFor.currency ?? "RWF"})`}><Input type="number" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
              <Field label="Transaction ID"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={method === "Bank" ? "Bank transfer reference" : "MoMo transaction ID (11 digits)"} /></Field>
              {method === "Bank" && (<>
                <Field label="Bank name"><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Bank of Kigali" /></Field>
                <Field label="Payment slip (image/PDF)"><Input type="file" accept="image/*,application/pdf" onChange={(e) => setSlip(e.target.files?.[0] ?? null)} /></Field>
              </>)}
            </div>
            {perr && <p className="rounded-md bg-red-bg px-3 py-2 text-sm text-status-refunded">{perr}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function OrderCard({ o, onAddPayment }: { o: Order; onAddPayment: () => void }) {
  const status = o.status === "rejected" ? "Rejected" : o.status === "refunded" ? "Refunded" : o.deliverOk ? "Delivered" : o.confirmedOk ? "Confirmed" : "Pending";
  const tone = o.status === "rejected" || o.status === "refunded" ? "red" : o.deliverOk ? "green" : o.confirmedOk ? "info" : "amber";
  const hasRejected = o.payments.some((p) => p.voided);
  const canPay = isActive(o.status) && !isFullyPaid(o);
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
        <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Total</p><p className="font-medium tabular-nums text-ink">{formatMoney(orderTotal(o), o.currency ?? "RWF")}</p></div>
        <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Balance</p><p className={`font-medium tabular-nums ${isFullyPaid(o) ? "text-green" : "text-ink"}`}>{isFullyPaid(o) ? "Paid" : formatMoney(balance(o), o.currency ?? "RWF")}</p></div>
      </div>
      {hasRejected && <p className="mt-2 text-xs font-medium text-red">A payment was rejected — re-collect and add the new payment.</p>}
      {o.payments.length > 0 && (
        <div className="mt-2 space-y-1">
          {o.payments.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-muted">{formatDateTime(p.on)} · {p.method ?? "—"} · {p.ref || "—"}</span>
              <span className="flex items-center gap-1.5"><span className="tabular-nums text-ink">{formatMoney(p.amt, o.currency ?? "RWF")}</span>{p.voided ? <Pill tone="red">Rejected</Pill> : p.verified ? <Pill tone="green">Verified</Pill> : <Pill tone="amber">Pending</Pill>}</span>
            </div>
          ))}
        </div>
      )}
      {canPay && <div className="mt-2.5 flex justify-end border-t border-line pt-2.5"><Button size="sm" variant={hasRejected ? "primary" : "ghost"} onClick={onAddPayment}>＋ Add payment</Button></div>}
    </div>
  );
}
