"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";

import { PRODUCTS, type Product, type Order, type Payment, type Province } from "@/lib/types";
import { availableFor } from "@/lib/types";
import { ALL_DISTRICTS, formatRWF, provinceOfDistrict, zoneOfDistrict } from "@/lib/config";
import { nowISO, formatDate, normalizePhone } from "@/lib/format";
import { logLine } from "@/lib/orders";

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
  const [district, setDistrict] = useState("");
  const [sector, setSector] = useState("");
  const [chicks, setChicks] = useState("");
  const [price, setPrice] = useState("");
  const [payAmt, setPayAmt] = useState("");
  const [payRef, setPayRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openDates = useMemo(
    () => availability.slice().filter((a) => a.ross > 0 || a.tetra > 0).sort((a, b) => (a.date < b.date ? -1 : 1)),
    [availability]
  );
  const selAvail = availability.find((a) => a.id === date);

  const existingCustomer = useMemo(() => {
    const key = normalizePhone(phone);
    if (key.length < 6) return null;
    const theirs = orders.filter((o) => normalizePhone(o.phone) === key);
    if (theirs.length === 0) return null;
    const latest = theirs.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return { name: latest.name, count: theirs.length };
  }, [phone, orders]);

  // A DSR may only take clients located in their own zone.
  const myZoneDistricts = useMemo(
    () => ALL_DISTRICTS.filter((d) => zoneOfDistrict(d) === myDsr?.zone),
    [myDsr]
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
    if (phone.trim().length < 6) return setError("Enter a valid phone number.");
    if (!district) return setError("Choose the client's district.");
    if (zoneOfDistrict(district) !== myDsr!.zone)
      return setError(`You can only take clients in your zone (${myDsr!.zone}). ${district} is outside it.`);
    if (!sector.trim()) return setError("Enter the client's sector.");
    if (nChicks <= 0) return setError("Chicks must be greater than zero.");
    if (nPrice <= 0) return setError("Enter a unit price.");
    if (selAvail && nChicks > availableFor(selAvail, product as Product, orders)) {
      return setError(`Not enough ${product} chicks available on ${formatDate(date)}. Please pick another day or a smaller order.`);
    }
    const payAmount = num(payAmt);
    if (payAmount > 0 && !payRef.trim()) return setError("Enter the transaction ID for the first payment.");

    const province: Province = (provinceOfDistrict(district) ?? "Eastern") as Province;
    const zone = zoneOfDistrict(district) ?? myDsr!.zone;
    const payments: Payment[] = [];
    const history = [logLine(user!, "Created order (Not confirmed)")];
    if (payAmount > 0) {
      payments.push({ amt: payAmount, ref: payRef.trim(), on: nowISO(), by: user!.email, verified: false });
      history.push(logLine(user!, `Recorded first payment ${payAmount.toLocaleString()} RWF (ref ${payRef.trim()})`));
    }
    const samedate = orders.filter((o) => o.date === date).length;
    const order: Order = {
      id: newId("ord"), product: product as Product, province, district, sector: sector.trim(),
      dsr: myDsr!.name, dsrId: myDsr!.id,
      name: (existingCustomer?.name ?? name).trim(), clientDistrict: district, clientSector: sector.trim(),
      phone: phone.trim(), chicks: nChicks, comp: 0, price: nPrice, date,
      status: "pending", by: user!.email, zone, created: date, createdAt: nowISO(),
      history, plan: samedate, payments,
    };
    setSaving(true);
    const res = await placeOrder(order);
    setSaving(false);
    if (!res.ok) {
      if (res.reason === "not_enough")
        return setError(`Not enough ${product} chicks available on ${formatDate(date)} anymore. Please pick another day or a smaller order.`);
      if (res.reason === "date_closed") return setError("That delivery date is no longer open.");
      if (res.reason === "out_of_zone") return setError(`That client is outside your zone (${myDsr!.zone}). You can only take clients in your zone.`);
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
            <Field label="Delivery date">
              {openDates.length === 0 ? (
                <p className="text-sm text-status-refunded">No ordering dates are open yet. Check back later.</p>
              ) : (
                <Select value={date} placeholder="Select an open delivery date" options={openDates.map((a) => ({ value: a.id, label: formatDate(a.date) }))} onChange={(e) => setDate(e.target.value)} />
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
            <Field label="Client name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Phone" required><Input type="tel" inputMode="numeric" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" /></Field>
            <Field label="District" hint={`Your zone (${myDsr.zone}) only`}><Select value={district} placeholder="Select district" options={myZoneDistricts.map((d) => ({ value: d, label: d }))} onChange={(e) => setDistrict(e.target.value)} /></Field>
            <Field label="Sector"><Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Client's sector" /></Field>
            <Field label="Chicks ordered"><Input type="number" min={1} value={chicks} onChange={(e) => setChicks(e.target.value)} /></Field>
            <Field label="Unit price (RWF)"><Input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-md bg-ink/5 p-3 text-sm">
            <Calc label="2% extra (free)" value={String(extra2)} />
            <Calc label="To deliver" value={String(toDeliverN)} />
            <Calc label="Total (charged)" value={formatRWF(total)} />
          </div>
        </Card>

        <Card>
          <CardHeader title="First payment (optional)" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Amount (RWF)"><Input type="number" min={0} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></Field>
            <Field label="Transaction ID"><Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="MTN / bank ref" /></Field>
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
