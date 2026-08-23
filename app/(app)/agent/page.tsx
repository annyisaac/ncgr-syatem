"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input, Select } from "@/components/ui/Select";

import { type Order, type Payment, type Province, type Currency, toDeliver } from "@/lib/types";
import { availableFor } from "@/lib/types";
import { ALL_DISTRICTS, formatMoney, provinceOfDistrict, sectorsOfDistrict, zoneOfDistrict } from "@/lib/config";
import { nowISO, formatDate, normalizePhone, todayISO, phoneDigitCount, isValidMomoRef } from "@/lib/format";
import { logLine } from "@/lib/orders";
import { uploadPaymentSlip } from "@/lib/db";
import { listAgentQuotas, type AgentQuota } from "@/lib/quota";

const num = (v: string) => Number(v) || 0;
const isActive = (s?: string) => s !== "refunded" && s !== "rejected";
const PRODUCT = "Ross 308" as const;

export default function AgentOrderPage() {
  const { user } = useAuth();
  const { orders, availability, placeOrder, newId } = useData();
  const { toast } = useToast();
  const router = useRouter();

  const [quotas, setQuotas] = useState<AgentQuota[]>([]);
  const email = (user?.email ?? "").toLowerCase();

  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");
  const [sector, setSector] = useState("");
  const [chicks, setChicks] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<Currency>("RWF");
  const [payAmt, setPayAmt] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payMethod, setPayMethod] = useState<"MoMo" | "Bank">("MoMo");
  const [bankName, setBankName] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    listAgentQuotas().then((q) => { if (active) setQuotas(q); }).catch(() => { /* keep */ });
    return () => { active = false; };
  }, []);

  // Chicks this agent has already committed on a date (their own active orders).
  const soldOn = useMemo(() => (d: string) =>
    orders.filter((o) => o.date === d && o.product === PRODUCT && isActive(o.status) && (o.by ?? "").toLowerCase() === email).reduce((s, o) => s + toDeliver(o), 0),
    [orders, email]);

  // Only the delivery dates this agent has a quota for, that are still open in
  // availability and where they have quota + capacity left.
  const sellableDates = useMemo(() => {
    const today = todayISO();
    return quotas
      .filter((q) => q.agentEmail.toLowerCase() === email)
      .map((q) => {
        const a = availability.find((x) => x.id === q.date);
        const remainingQuota = Math.max(0, q.chicks - soldOn(q.date));
        const dateLeft = a ? availableFor(a, PRODUCT, orders) : 0;
        return { date: q.date, chicks: q.chicks, remainingQuota, dateLeft, open: !!a && !a.closed && q.date >= today && a.ross > 0 };
      })
      .filter((x) => x.open && x.remainingQuota > 0)
      .sort((x, y) => (x.date < y.date ? -1 : 1));
  }, [quotas, email, availability, orders, soldOn]);

  const selDate = sellableDates.find((x) => x.date === date) ?? null;
  const nChicks = num(chicks);
  const nPrice = num(price);
  const extra2 = Math.round(nChicks * 0.02);
  const toDeliverN = nChicks + extra2;
  const total = nChicks * nPrice;
  const sectorOptions = useMemo(() => sectorsOfDistrict(district).map((s) => ({ value: s, label: s })), [district]);

  if (!user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date) return setError("Choose a delivery date you have a quota for.");
    if (!selDate) return setError("That date is no longer available to you.");
    if (!name.trim()) return setError("Enter the client name.");
    if (phoneDigitCount(phone) < 10) return setError("Phone number must be at least 10 digits.");
    if (!district) return setError("Choose the client's district.");
    if (!sector.trim()) return setError("Choose the client's sector.");
    if (nChicks <= 0) return setError("Chicks must be greater than zero.");
    if (nPrice <= 0) return setError("Enter a unit price.");
    // Quota: this order's chicks (chicks + 2% free) must fit the agent's remaining allocation.
    if (toDeliverN > selDate.remainingQuota) {
      return setError(`Your quota for ${formatDate(date)} is ${selDate.remainingQuota.toLocaleString()} chicks left — this order needs ${toDeliverN.toLocaleString()} (incl. 2% free).`);
    }
    const payAmount = num(payAmt);
    if (payAmount > 0) {
      if (!payRef.trim()) return setError("Enter the transaction ID for the first payment.");
      if (payMethod === "MoMo" && !isValidMomoRef(payRef)) return setError("MoMo transaction ID must be exactly 11 digits.");
      if (payMethod === "Bank" && !bankName.trim()) return setError("Enter the bank name.");
      if (payMethod === "Bank" && !slipFile) return setError("Upload the bank payment slip.");
    }

    const province: Province = (provinceOfDistrict(district) ?? "Eastern") as Province;
    const zone = zoneOfDistrict(district) ?? "Zone 1";

    let slipPath: string | undefined;
    if (payAmount > 0 && payMethod === "Bank" && slipFile) {
      setSaving(true);
      try { slipPath = await uploadPaymentSlip(slipFile); }
      catch (err) { setSaving(false); return setError(err instanceof Error ? err.message : "Could not upload the payment slip."); }
    }

    const payments: Payment[] = [];
    const history = [logLine(user!, "Created order — field agent (Not confirmed)")];
    if (payAmount > 0) {
      payments.push({ amt: payAmount, ref: payRef.trim(), on: nowISO(), by: user!.email, method: payMethod, ...(payMethod === "Bank" ? { bankName: bankName.trim() } : {}), ...(slipPath ? { slipPath } : {}), verified: false });
      history.push(logLine(user!, `Recorded first payment ${payAmount.toLocaleString()} ${currency} via ${payMethod} (ref ${payRef.trim()})`));
    }
    const samedate = orders.filter((o) => o.date === date).length;
    const order: Order = {
      id: newId("ord"), product: PRODUCT, province, district, sector: sector.trim(),
      dsr: user!.name,
      name: name.trim(), clientDistrict: district, clientSector: sector.trim(),
      phone: phone.trim(), chicks: nChicks, comp: 0, price: nPrice, date,
      status: "pending", by: user!.email, zone, created: date, createdAt: nowISO(),
      history, plan: samedate, payments, currency,
    };
    // One live order per customer per delivery date (matches the DB guard).
    const dupKey = normalizePhone(order.phone);
    const dup = orders.find((o) => o.id !== order.id && o.date === order.date && isActive(o.status) && dupKey && normalizePhone(o.phone) === dupKey);
    if (dup) return setError(`${order.name} already has an order for ${formatDate(order.date)}. A customer can only have one order per delivery date.`);

    setSaving(true);
    const res = await placeOrder(order);
    setSaving(false);
    if (!res.ok) {
      if (res.reason === "not_enough") return setError(`Not enough ${PRODUCT} chicks available on ${formatDate(date)} anymore. Pick another day or a smaller order.`);
      if (res.reason === "no_quota") return setError(`You don't have a quota for ${formatDate(date)}. Ask the Admin to allocate you chicks for that date.`);
      if (res.reason === "quota_exceeded") return setError(`This exceeds your remaining quota for ${formatDate(date)}${typeof res.left === "number" ? ` (${res.left.toLocaleString()} left)` : ""}.`);
      if (res.reason === "date_closed") return setError("That delivery date is no longer open.");
      if (res.reason === "duplicate") return setError(`${order.name} already has an order for ${formatDate(order.date)}.`);
      if (res.reason === "dup_payment") return setError(`That transaction reference${res.message ? ` (${res.message})` : ""} is already recorded on another order.`);
      return setError("Could not place the order. Check your connection and try again.");
    }
    toast(`Order created for ${order.name}.`);
    // Refresh quotas view (remaining recomputes from the new order automatically).
    router.push("/agent/orders");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">New Ross 308 order</h1>
        <p className="text-sm text-muted">Collect an order in the field. You can sell up to your quota on each delivery date.</p>
      </div>

      {sellableDates.length === 0 ? (
        <Card><p className="text-sm text-muted">You have no delivery date with quota to sell right now. Ask the Admin to assign you chicks for a delivery date.</p></Card>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Card>
            <CardHeader title="Product & delivery day" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Product"><div className="flex h-12 items-center"><Pill tone="ross">Ross 308</Pill></div></Field>
              <Field label="Delivery date" required>
                <Select value={date} placeholder="Select a delivery date" onChange={(e) => setDate(e.target.value)}
                  options={sellableDates.map((d) => ({ value: d.date, label: `${formatDate(d.date)} · ${d.remainingQuota.toLocaleString()} left for you` }))} />
              </Field>
            </div>
            {selDate && <p className="mt-2 text-xs text-muted">Your quota for {formatDate(selDate.date)}: <strong className="text-ink">{selDate.chicks.toLocaleString()}</strong> · remaining <strong className="text-green">{selDate.remainingQuota.toLocaleString()}</strong></p>}
          </Card>

          <Card>
            <CardHeader title="Client & quantity" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Client name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Phone" required><Input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" /></Field>
              <Field label="District" required><Select value={district} placeholder="Select district" options={ALL_DISTRICTS.map((d) => ({ value: d, label: d }))} onChange={(e) => { setDistrict(e.target.value); setSector(""); }} /></Field>
              <Field label="Sector" required><Select value={sector} placeholder={district ? "Select sector" : "Choose district first"} options={sectorOptions} disabled={!district} onChange={(e) => setSector(e.target.value)} /></Field>
              <Field label="Chicks ordered" required><Input type="number" min={1} value={chicks} onChange={(e) => setChicks(e.target.value)} /></Field>
              <Field label="Currency"><Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} options={[{ value: "RWF", label: "RWF — Rwandan Franc" }, { value: "USD", label: "USD — US Dollar" }, { value: "EUR", label: "EUR — Euro" }]} /></Field>
              <Field label={`Unit price (${currency})`} required><Input type="number" min={0} step={currency === "RWF" ? "1" : "0.01"} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-md bg-ink/5 p-3 text-sm">
              <Calc label="2% extra (free)" value={String(extra2)} />
              <Calc label="To deliver" value={String(toDeliverN)} />
              <Calc label="Total (charged)" value={formatMoney(total, currency)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="First payment (optional)" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Payment method"><Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as "MoMo" | "Bank")} options={[{ value: "MoMo", label: "Mobile Money (MoMo)" }, { value: "Bank", label: "Bank transfer" }]} /></Field>
              <Field label={`Amount (${currency})`}><Input type="number" min={0} step={currency === "RWF" ? "1" : "0.01"} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></Field>
              <Field label="Transaction ID"><Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder={payMethod === "Bank" ? "Bank transfer reference" : "MoMo transaction ID (11 digits)"} /></Field>
              {payMethod === "Bank" && (<>
                <Field label="Bank name"><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Bank of Kigali" /></Field>
                <Field label="Payment slip (image/PDF)"><Input type="file" accept="image/*,application/pdf" onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)} /></Field>
              </>)}
            </div>
          </Card>

          {error && <p className="rounded-md bg-red-bg px-3 py-2 text-sm text-status-refunded">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={saving}>{saving ? "Placing…" : "Create order"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Calc({ label, value }: { label: string; value: string }) {
  return (<div><p className="text-xs text-ink/60">{label}</p><p className="font-semibold text-ink">{value}</p></div>);
}
