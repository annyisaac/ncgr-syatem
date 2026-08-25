"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";

import { PRODUCTS, type Product, type Order, type Payment, type Province, type Currency } from "@/lib/types";
import { availableFor } from "@/lib/types";
import { ALL_DISTRICTS, formatMoney, provinceOfDistrict, sectorsOfDistrict, zoneOfDistrict } from "@/lib/config";
import { nowISO, formatDate, normalizePhone, todayISO, phoneDigitCount, isValidMomoRef } from "@/lib/format";
import { logLine } from "@/lib/orders";
import { uploadPaymentSlip } from "@/lib/db";

const num = (v: string) => Number(v) || 0;

export default function DsrOrderPage() {
  const { user } = useAuth();
  const { dsrs, orders, availability, placeOrder, newId } = useData();
  const { toast } = useToast();
  const router = useRouter();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);

  const [product, setProduct] = useState<Product | "">("");
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isCompany, setIsCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyTin, setCompanyTin] = useState("");
  const [consignee, setConsignee] = useState("");
  const [consigneePhone, setConsigneePhone] = useState("");
  const [district, setDistrict] = useState("");
  const [sector, setSector] = useState("");
  const [chicks, setChicks] = useState("");
  const [price, setPrice] = useState("");
  const [payAmt, setPayAmt] = useState("");
  const [currency, setCurrency] = useState<Currency>("RWF");
  const [payRef, setPayRef] = useState("");
  const [payMethod, setPayMethod] = useState<"MoMo" | "Bank">("MoMo");
  const [bankName, setBankName] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openDates = useMemo(
    () => availability.slice().filter((a) => !a.closed && a.date >= todayISO() && (a.ross > 0 || a.tetra > 0)).sort((a, b) => (a.date < b.date ? -1 : 1)),
    [availability]
  );
  const selAvail = availability.find((a) => a.id === date);

  const existingCustomer = useMemo(() => {
    const key = normalizePhone(phone);
    if (key.length < 6) return null;
    const theirs = orders.filter((o) => normalizePhone(o.phone) === key);
    if (theirs.length === 0) return null;
    const latest = theirs.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return { name: latest.name, count: theirs.length, latest };
  }, [phone, orders]);

  // Returning customer → reuse their saved name & location, once per matched
  // customer, straight from the phone field (event handler — never during
  // render). Product, chicks, unit price, date and payment stay fresh. Only
  // reuse the district/sector if it's in this DSR's zone (their zone rule).
  const filledCustomerRef = useRef<string | null>(null);
  function onPhoneChange(value: string) {
    setPhone(value);
    const key = normalizePhone(value);
    const theirs = key.length >= 6 ? orders.filter((o) => normalizePhone(o.phone) === key) : [];
    if (theirs.length === 0) { filledCustomerRef.current = null; return; }
    const o = theirs.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (filledCustomerRef.current === o.id) return;
    filledCustomerRef.current = o.id;
    setName(o.name);
    if (o.district && zoneOfDistrict(o.district) === myDsr?.zone) {
      setDistrict(o.district);
      if (o.sector) setSector(o.sector);
    }
  }

  // A DSR may only take clients located in their own zone.
  const myZoneDistricts = useMemo(
    () => ALL_DISTRICTS.filter((d) => zoneOfDistrict(d) === myDsr?.zone),
    [myDsr]
  );

  const sectorOptions = useMemo(
    () => sectorsOfDistrict(district).map((s) => ({ value: s, label: s })),
    [district]
  );

  const nChicks = num(chicks);
  const nPrice = num(price);
  const extra2 = Math.round(nChicks * 0.02);
  const toDeliverN = nChicks + extra2;
  const total = nChicks * nPrice;

  if (!user) return null;
  if (!myDsr) return <Card><p className="text-sm text-muted">Your DSR profile could not be found. Ask your zone manager.</p></Card>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!product) return setError("Choose a product.");
    if (!date) return setError("Choose an open delivery date.");
    if (!name.trim()) return setError("Enter the client name.");
    if (phoneDigitCount(phone) < 10) return setError("Phone number must be at least 10 digits.");
    if (!district) return setError("Choose the client's district.");
    if (zoneOfDistrict(district) !== myDsr!.zone)
      return setError(`You can only take clients in your zone (${myDsr!.zone}). ${district} is outside it.`);
    if (!sector.trim()) return setError("Enter the client's sector.");
    if (isCompany) {
      if (!companyName.trim()) return setError("Enter the company name.");
      if (!companyTin.trim()) return setError("Enter the company TIN.");
      if (!consignee.trim()) return setError("Enter the consignee's name.");
      if (phoneDigitCount(consigneePhone) < 10) return setError("Consignee phone must be at least 10 digits.");
    }
    if (nChicks <= 0) return setError("Chicks must be greater than zero.");
    if (nPrice <= 0) return setError("Enter a unit price.");
    if (selAvail && nChicks > availableFor(selAvail, product as Product, orders)) {
      return setError(`Not enough ${product} chicks available on ${formatDate(date)}. Please pick another day or a smaller order.`);
    }
    const payAmount = num(payAmt);
    if (payAmount > 0) {
      if (!payRef.trim()) return setError("Enter the transaction ID for the first payment.");
      if (payMethod === "MoMo" && !isValidMomoRef(payRef)) return setError("MoMo transaction ID must be exactly 11 digits.");
      if (payMethod === "Bank" && !bankName.trim()) return setError("Enter the bank name.");
      if (payMethod === "Bank" && !slipFile) return setError("Upload the bank payment slip.");
    }

    const province: Province = (provinceOfDistrict(district) ?? "Eastern") as Province;
    const zone = zoneOfDistrict(district) ?? myDsr!.zone;

    // Upload the bank slip first (private bucket) so the order stores only its path.
    let slipPath: string | undefined;
    if (payAmount > 0 && payMethod === "Bank" && slipFile) {
      setSaving(true);
      try {
        slipPath = await uploadPaymentSlip(slipFile);
      } catch (err) {
        setSaving(false);
        return setError(err instanceof Error ? err.message : "Could not upload the payment slip.");
      }
    }

    const payments: Payment[] = [];
    const history = [logLine(user!, "Created order (Not confirmed)")];
    if (payAmount > 0) {
      payments.push({
        amt: payAmount, ref: payRef.trim(), on: nowISO(), by: user!.email,
        method: payMethod,
        ...(payMethod === "Bank" ? { bankName: bankName.trim() } : {}),
        ...(slipPath ? { slipPath } : {}),
        verified: false,
      });
      history.push(logLine(user!, `Recorded first payment ${payAmount.toLocaleString()} ${currency} via ${payMethod} (ref ${payRef.trim()})`));
    }
    const samedate = orders.filter((o) => o.date === date).length;
    const order: Order = {
      id: newId("ord"), product: product as Product, province, district, sector: sector.trim(),
      dsr: myDsr!.name, dsrId: myDsr!.id,
      name: (existingCustomer?.name ?? name).trim(), clientDistrict: district, clientSector: sector.trim(),
      phone: phone.trim(), chicks: nChicks, comp: 0, price: nPrice, date,
      status: "pending", by: user!.email, zone, created: date, createdAt: nowISO(),
      history, plan: samedate, payments, currency,
      ...(isCompany && companyName.trim() ? { companyName: companyName.trim() } : {}),
      ...(isCompany && companyTin.trim() ? { companyTin: companyTin.trim() } : {}),
      ...(isCompany && consignee.trim() ? { consignee: consignee.trim() } : {}),
      ...(isCompany && consigneePhone.trim() ? { consigneePhone: consigneePhone.trim() } : {}),
    };
    // One live order per customer per delivery date PER PRODUCT — different
    // products on the same day are allowed (matches the DB guard in place_order).
    const dupKey = normalizePhone(order.phone);
    const dup = orders.find(
      (o) =>
        o.id !== order.id &&
        o.date === order.date &&
        o.product === order.product &&
        o.status !== "rejected" &&
        o.status !== "refunded" &&
        (dupKey
          ? normalizePhone(o.phone) === dupKey
          : order.name.trim() !== "" &&
            o.name.trim().toLowerCase() === order.name.trim().toLowerCase())
    );
    if (dup) return setError(`${order.name} (${order.phone}) already has a ${order.product} order for ${formatDate(order.date)}. A customer can only have one order per product per delivery date.`);

    setSaving(true);
    const res = await placeOrder(order);
    setSaving(false);
    if (!res.ok) {
      if (res.reason === "not_enough")
        return setError(`Not enough ${product} chicks available on ${formatDate(date)} anymore. Please pick another day or a smaller order.`);
      if (res.reason === "date_closed") return setError("That delivery date is no longer open.");
      if (res.reason === "out_of_zone") return setError(`That client is outside your zone (${myDsr!.zone}). You can only take clients in your zone.`);
      if (res.reason === "duplicate") return setError(`${order.name} already has a ${order.product} order for ${formatDate(order.date)}. A customer can only have one order per product per delivery date.`);
      if (res.reason === "dup_payment") return setError(`That transaction reference${res.message ? ` (${res.message})` : ""} is already recorded on another order. Check the reference and enter the correct one.`);
      return setError("Could not place the order. Please check your connection and try again.");
    }
    toast(`Order created for ${order.name}.`);
    router.push("/dsr/orders");
  }

  return (
    <div className="space-y-4">

      <form onSubmit={submit} className="space-y-4">
        <Card>
          <CardHeader title="Product & delivery day" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Product">
              <Select value={product} placeholder="Select product" options={PRODUCTS.map((p) => ({ value: p, label: p }))} onChange={(e) => setProduct(e.target.value as Product)} />
            </Field>
            <Field label="Delivery date" required>
              {openDates.length === 0 ? (
                <p className="text-sm text-status-refunded">No ordering dates are open yet. Check back later.</p>
              ) : (
                <Select value={date} placeholder="Select an open delivery date" options={openDates.map((a) => ({ value: a.id, label: formatDate(a.date) + (product ? ` · ${availableFor(a, product as Product, orders).toLocaleString()} left` : "") }))} onChange={(e) => setDate(e.target.value)} />
              )}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Client & quantity" />
          {existingCustomer && (
            <div className="mb-4 rounded-xl border border-[#efdfae] bg-gold-bg px-3 py-2.5 text-sm">
              <strong className="text-ink">Existing customer:</strong> {existingCustomer.name}{" "}
              <span className="text-muted">· {existingCustomer.count} order(s). This order is added to them.</span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Client name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Phone" required><Input type="tel" inputMode="numeric" required value={phone} onChange={(e) => onPhoneChange(e.target.value)} placeholder="07xxxxxxxx" /></Field>
            <Field label="District" required hint={`Your zone (${myDsr.zone}) only`}><Select value={district} placeholder="Select district" options={myZoneDistricts.map((d) => ({ value: d, label: d }))} onChange={(e) => { setDistrict(e.target.value); setSector(""); }} /></Field>
            <Field label="Sector" required><Select value={sector} placeholder={district ? "Select sector" : "Choose district first"} options={sectorOptions} disabled={!district} onChange={(e) => setSector(e.target.value)} /></Field>
            <Field label="Chicks ordered" required><Input type="number" min={1} value={chicks} onChange={(e) => setChicks(e.target.value)} /></Field>
            <Field label="Currency" hint="Applies to the whole order — price & payments"><Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} options={[{ value: "RWF", label: "RWF — Rwandan Franc" }, { value: "USD", label: "USD — US Dollar" }, { value: "EUR", label: "EUR — Euro" }]} /></Field>
            <Field label={`Unit price (${currency})`} required><Input type="number" min={0} step={currency === "RWF" ? "1" : "0.01"} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-md bg-ink/5 p-3 text-sm">
            <Calc label="2% extra (free)" value={String(extra2)} />
            <Calc label="To deliver" value={String(toDeliverN)} />
            <Calc label="Total (charged)" value={formatMoney(total, currency)} />
          </div>
        </Card>

        <Card>
          <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={isCompany} onChange={(e) => setIsCompany(e.target.checked)} /> This is a company / business order</label>
          {isCompany && (<>
            <p className="mb-3 mt-1 text-xs text-muted">These appear on the invoice and the payment proof.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Company name" required><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Registered company name" /></Field>
              <Field label="Company TIN" required><Input value={companyTin} onChange={(e) => setCompanyTin(e.target.value)} inputMode="numeric" placeholder="Tax ID number" /></Field>
              <Field label="Consignee (person receiving)" required><Input value={consignee} onChange={(e) => setConsignee(e.target.value)} placeholder="Full name" /></Field>
              <Field label="Consignee phone" required><Input type="tel" inputMode="numeric" value={consigneePhone} onChange={(e) => setConsigneePhone(e.target.value)} placeholder="07xxxxxxxx" /></Field>
            </div>
          </>)}
        </Card>

        <Card>
          <CardHeader title="First payment (optional)" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Payment method">
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as "MoMo" | "Bank")} options={[{ value: "MoMo", label: "Mobile Money (MoMo)" }, { value: "Bank", label: "Bank transfer" }]} />
            </Field>
            <Field label={`Amount (${currency})`}><Input type="number" min={0} step={currency === "RWF" ? "1" : "0.01"} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></Field>
            <Field label="Transaction ID"><Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder={payMethod === "Bank" ? "Bank transfer reference" : "MoMo transaction ID (11 digits)"} /></Field>
            {payMethod === "Bank" && (
              <>
                <Field label="Bank name"><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Bank of Kigali" /></Field>
                <Field label="Payment slip (image/PDF)"><Input type="file" accept="image/*,application/pdf" onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)} /></Field>
              </>
            )}
          </div>
        </Card>

        {error && <p className="rounded-md bg-red-bg px-3 py-2 text-sm text-status-refunded">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push("/dsr")}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Placing…" : "Create order"}</Button>
        </div>
      </form>
    </div>
  );
}

function Calc({ label, value }: { label: string; value: string }) {
  return (<div><p className="text-xs text-ink/60">{label}</p><p className="font-semibold text-ink">{value}</p></div>);
}
