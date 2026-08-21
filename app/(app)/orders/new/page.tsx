"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";

import type { Currency, Order, Payment, Product, Province } from "@/lib/types";
import { availableFor, customerCredit, orderTotal } from "@/lib/types";
import { clientRecordKey, findClient, creditRefundedFor } from "@/lib/clients";
import {
  DISTRICTS_BY_PROVINCE,
  PROVINCES,
  ALL_DISTRICTS,
  formatRWF,
  formatMoney,
  sectorsOfDistrict,
  zoneDistricts,
  zoneOfDistrict,
  zoneProvinces,
} from "@/lib/config";
import { nowISO, normalizePhone, formatDate, todayISO, phoneDigitCount, isValidMomoRef } from "@/lib/format";
import { logLine } from "@/lib/orders";
import { uploadPaymentSlip } from "@/lib/db";

export default function NewOrderPage() {
  const { user } = useAuth();
  const { dsrs, orders, availability, placeOrder, newId, clients } = useData();
  const { toast } = useToast();
  const router = useRouter();

  // Opened from a customer (e.g. the client detail "Create new order") — prefill
  // their identity so the seller doesn't re-type what we already know.
  const search = useSearchParams();
  const initialPhone = search.get("phone") ?? "";
  const initialName = search.get("name") ?? "";
  const initialProduct = search.get("product") ?? "";

  // Roles allowed to create orders.
  const roleProduct: Product | undefined =
    user?.role === "Tetra Zone Manager" || user?.role === "Tetra Payment Checker"
      ? "Tetra Super Harco"
      : user?.role === "Ross Order Receiver" || user?.role === "Ross Payment Checker"
        ? "Ross 308"
        : undefined;
  const isAdmin = user?.role === "Admin";
  const canCreate = isAdmin || roleProduct !== undefined;

  const [product, setProduct] = useState<Product | "">(
    roleProduct ??
      (initialProduct === "Ross 308" || initialProduct === "Tetra Super Harco" ? (initialProduct as Product) : "")
  );
  const isTetra = product === "Tetra Super Harco";

  const [province, setProvince] = useState<Province | "">("");
  const [district, setDistrict] = useState("");
  const [dsrId, setDsrId] = useState("");
  const [rossSource, setRossSource] = useState<"direct" | "dsr">("direct");
  const [sector, setSector] = useState("");
  const [name, setName] = useState(initialName);
  const [clientDistrict, setClientDistrict] = useState("");
  const [clientSector, setClientSector] = useState("");
  const [phone, setPhone] = useState(initialPhone);
  // Business/company buyer (optional)
  const [isCompany, setIsCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyTin, setCompanyTin] = useState("");
  const [consignee, setConsignee] = useState("");
  const [consigneePhone, setConsigneePhone] = useState("");
  const [chicks, setChicks] = useState("");
  const [comp, setComp] = useState("0");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [pickup, setPickup] = useState("");
  const [payAmt, setPayAmt] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payMethod, setPayMethod] = useState<"MoMo" | "Bank">("MoMo");
  const [currency, setCurrency] = useState<Currency>("RWF");
  const [bankName, setBankName] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isZoneManager = user?.role === "Tetra Zone Manager";

  const provinceOptions = useMemo(() => {
    const list = isZoneManager && user?.zone ? zoneProvinces(user.zone) : PROVINCES;
    return list.map((p) => ({ value: p, label: p }));
  }, [isZoneManager, user]);

  const tetraDistrictOptions = useMemo(() => {
    if (!province) return [];
    const list =
      isZoneManager && user?.zone
        ? zoneDistricts(user.zone, province)
        : (DISTRICTS_BY_PROVINCE[province] ?? []); // legacy orders may carry an unknown province (e.g. "Kigali")
    return list.map((d) => ({ value: d, label: d }));
  }, [province, isZoneManager, user]);

  const dsrOptions = useMemo(() => {
    if (!district) return [];
    return dsrs
      .filter((d) => d.active && d.district === district)
      .map((d) => ({ value: d.id, label: `${d.name} — ${d.phone}` }));
  }, [dsrs, district]);

  // Ross is sold across both zones, so its DSR picker lists every active DSR
  // (from both zone managers) and selecting one fills in the location.
  const allDsrOptions = useMemo(
    () =>
      dsrs
        .filter((d) => d.active)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({ value: d.id, label: `${d.name} — ${d.phone} · ${d.district} (${d.zone})` })),
    [dsrs]
  );

  function selectRossDsr(id: string) {
    setDsrId(id);
    const d = dsrs.find((x) => x.id === id);
    if (d) { setDistrict(d.district); setSector(""); }
  }

  const selectedDsr = dsrs.find((d) => d.id === dsrId);
  const sectorOptions = useMemo(
    () => (selectedDsr ? selectedDsr.sectors.map((s) => ({ value: s, label: s })) : []),
    [selectedDsr]
  );
  // Official sectors of the client's district — for the client's own sector.
  const clientSectorOptions = useMemo(
    () => sectorsOfDistrict(clientDistrict).map((s) => ({ value: s, label: s })),
    [clientDistrict]
  );

  // Customer de-duplication: a phone number already in the system is an existing
  // customer — the new order is added to them, not a new customer registration.
  const existingCustomer = useMemo(() => {
    const key = normalizePhone(phone);
    if (key.length < 6) return null;
    const theirs = orders.filter((o) => normalizePhone(o.phone) === key);
    const rec = findClient(clients, phone, name);
    if (theirs.length === 0 && !rec) return null;
    const latest = theirs.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return { name: rec?.name ?? latest?.name ?? name, code: rec?.code, count: theirs.length, latest };
  }, [phone, name, orders, clients]);

  // Returning customer → reuse their saved identity & location, filled once per
  // matched customer directly from the phone field. Runs in an event handler
  // (never during render), so it can't trigger a render loop. Order-specific
  // fields — product, chicks, compensation, unit price, date and payment — are
  // always left for fresh entry.
  const filledCustomerRef = useRef<string | null>(null);
  function prefillFromCustomer(value: string) {
    const key = normalizePhone(value);
    if (key.length < 6) { filledCustomerRef.current = null; return; }
    const theirs = orders
      .filter((o) => normalizePhone(o.phone) === key)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const rec = findClient(clients, value, name);
    if (theirs.length === 0 && !rec) { filledCustomerRef.current = null; return; }
    const o = theirs[0];
    const marker = o?.id ?? rec?.id ?? null;
    if (filledCustomerRef.current === marker) return;
    filledCustomerRef.current = marker;
    const nm = rec?.name ?? o?.name;
    if (nm) setName(nm);
    if (o) {
      if (o.province && DISTRICTS_BY_PROVINCE[o.province as Province]) setProvince(o.province as Province);
      if (o.district) setDistrict(o.district);
      if (o.sector) setSector(o.sector);
      if (o.dsrId) { setDsrId(o.dsrId); setRossSource("dsr"); }
    }
    // The client's own district & sector — reuse the most recent value we already
    // know (registry record → the most recent order that carries a client
    // district/sector → the order's location), so a returning customer is never
    // asked again. Sector is only reused when it's valid for the district.
    const cd = rec?.district
      || theirs.find((x) => x.clientDistrict)?.clientDistrict
      || theirs.find((x) => x.district)?.district
      || "";
    if (cd) setClientDistrict(cd);
    const cs = rec?.sector
      || theirs.find((x) => x.clientSector)?.clientSector
      || theirs.find((x) => x.sector)?.sector
      || "";
    if (cd && cs && sectorsOfDistrict(cd).includes(cs)) setClientSector(cs);
  }
  function onPhoneChange(value: string) {
    setPhone(value);
    prefillFromCustomer(value);
  }

  // Opened from a customer link (?phone=…): prefill their identity once the
  // orders/clients are loaded. One-shot, so it never overrides later edits.
  const prefilledFromQuery = useRef(false);
  useEffect(() => {
    if (prefilledFromQuery.current) return;
    if (initialPhone && normalizePhone(initialPhone).length >= 6 && orders.length > 0) {
      prefilledFromQuery.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      prefillFromCustomer(initialPhone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, clients]);

  // Any credit this customer is carrying — auto-applied to this order on save.
  const custCredit = useMemo(() => {
    const nm = (existingCustomer?.name ?? name).trim();
    if (!nm || normalizePhone(phone).length < 6) return 0;
    const refunded = creditRefundedFor(clients, phone.trim(), nm);
    return customerCredit(orders, { phone: phone.trim(), name: nm }, undefined, refunded);
  }, [orders, clients, phone, name, existingCustomer]);

  // Ordering availability: only Admin-opened dates are selectable. Remaining
  // chicks per date are shown to every staff role that can create an order here
  // (Admin, Zone Manager, the Ross order receiver, and both payment checkers),
  // so they can see each delivery date's remaining stock while ordering.
  const canSeeAvail = canCreate;
  // Only offer dates that carry the chosen product's chicks — a Ross seller
  // never sees Tetra-only dates, a Tetra role never sees Ross-only dates.
  const openDates = useMemo(
    () =>
      availability
        .slice()
        // Only open, not-yet-finished dates are selectable for a new order.
        .filter((a) => !a.closed && a.date >= todayISO() && (a.ross > 0 || a.tetra > 0))
        .filter((a) => !product || (product === "Ross 308" ? a.ross > 0 : a.tetra > 0))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    [availability, product]
  );
  const selAvail = availability.find((a) => a.id === date);
  const remaining = selAvail && product ? availableFor(selAvail, product as Product, orders) : 0;

  const nChicks = Number(chicks) || 0;
  const nComp = Number(comp) || 0;
  const nPrice = Number(price) || 0;
  const extra2 = Math.round(nChicks * 0.02);
  const toDeliver = nChicks + extra2 + nComp;
  const total = nChicks * nPrice;
  // Live order summary figures
  const firstPay = Number(payAmt) || 0;
  const creditToApply = Math.min(custCredit, total);
  const orderBalance = Math.max(0, total - creditToApply - firstPay);

  function resetProductDependent() {
    setProvince("");
    setDistrict("");
    setDsrId("");
    setSector("");
  }

  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return; // guard against a double-submit while one is in flight
    setError(null);

    // A Ross 308 direct customer has no DSR, so the order's location is simply the
    // client's own district/sector (captured below) — we don't ask for it twice.
    const rossDirect = product === "Ross 308" && rossSource === "direct";
    const effDistrict = rossDirect ? clientDistrict : district;
    const effSector = rossDirect ? clientSector.trim() : sector.trim();

    if (!product) return setError("Choose a product.");
    if (isTetra && !province) return setError("Choose a province.");
    if (!rossDirect && !district) return setError("Choose a district.");
    if (isTetra && !dsrId) return setError("Choose a registered DSR.");
    if (product === "Ross 308" && rossSource === "dsr" && !dsrId) return setError("Select a DSR, or choose “No DSR”.");
    if (!rossDirect && !sector.trim()) return setError("Enter or choose a sector.");
    if (!name.trim()) return setError("Enter the client name.");
    if (phoneDigitCount(phone) < 10) return setError("Phone number must be at least 10 digits.");
    if (!clientDistrict) return setError("Choose the client's district.");
    if (!clientSector.trim()) return setError("Enter the client's sector.");
    if (nChicks <= 0) return setError("Chicks must be greater than zero.");
    if (nComp < 0) return setError("Compensated chicks cannot be negative.");
    if (nPrice <= 0) return setError("Enter a unit price.");
    if (!date) return setError("Choose a delivery date.");
    if (!pickup.trim()) return setError("Enter the pickup location.");
    if (isCompany) {
      if (!companyName.trim()) return setError("Enter the company name.");
      if (!companyTin.trim()) return setError("Enter the company TIN.");
      if (!consignee.trim()) return setError("Enter the consignee's name.");
      if (phoneDigitCount(consigneePhone) < 10) return setError("Consignee phone must be at least 10 digits.");
    }
    if (selAvail) {
      const left = availableFor(selAvail, product as Product, orders);
      // Counts what actually leaves the hatchery for this order (chicks + 2% + comp).
      if (toDeliver > left) {
        return setError(canSeeAvail
          ? `Only ${left.toLocaleString()} ${product} chicks left on ${formatDate(date)} — this order needs ${toDeliver.toLocaleString()} (incl. 2% + compensation).`
          : `Not enough ${product} chicks available on ${formatDate(date)} for this order.`);
      }
    }

    const payAmount = Number(payAmt) || 0;
    if (payAmount > 0) {
      if (!payRef.trim()) return setError("Enter the transaction reference for the first payment.");
      if (payMethod === "MoMo" && !isValidMomoRef(payRef)) return setError("MoMo transaction ID must be exactly 11 digits.");
      if (payMethod === "Bank" && !bankName.trim()) return setError("Enter the bank name.");
      if (payMethod === "Bank" && !slipFile) return setError("Upload the bank payment slip.");
    }

    const orderProvince: Province = isTetra
      ? (province as Province)
      : (PROVINCES.find((p) => DISTRICTS_BY_PROVINCE[p].includes(effDistrict)) ??
        "Eastern");
    const zone = zoneOfDistrict(effDistrict) ?? user!.zone ?? "Zone 1";

    // Upload the bank slip first (to the private bucket) so the order only
    // stores its path.
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
        amt: payAmount,
        ref: payRef.trim(),
        on: nowISO(),
        by: user!.email,
        method: payMethod,
        ...(payMethod === "Bank" ? { bankName: bankName.trim() } : {}),
        ...(slipPath ? { slipPath } : {}),
        verified: false,
      });
      history.push(
        logLine(user!, `Recorded first payment ${payAmount.toLocaleString()} ${currency} via ${payMethod} (ref ${payRef.trim()})`)
      );
    }

    const samedate = orders.filter((o) => o.date === date).length;
    const finalName = (existingCustomer?.name ?? name).trim();
    const clientId = clientRecordKey({ phone: phone.trim(), name: finalName });

    // Auto-apply any credit this customer is carrying (overpayments / short
    // deliveries), less any that has been refunded, capped at this order's bill.
    const refunded = creditRefundedFor(clients, phone.trim(), finalName);
    const orderTotalValue = orderTotal({ chicks: nChicks, price: nPrice });
    const applied = Math.min(
      customerCredit(orders, { phone: phone.trim(), name: finalName }, undefined, refunded),
      orderTotalValue
    );
    // Credit fully covers the order and no cash was recorded → it's paid by
    // already-verified money, so confirm it automatically (nothing to verify).
    const fullyByCredit = applied >= orderTotalValue && payAmount <= 0;
    if (applied > 0) {
      history.push(logLine(user!, `Applied ${applied.toLocaleString()} RWF customer credit`));
    }
    if (fullyByCredit) {
      history.push(logLine(user!, "Confirmed — fully covered by customer credit"));
    }

    const order: Order = {
      id: newId("ord"),
      product: product as Product,
      province: orderProvince,
      district: effDistrict,
      sector: effSector,
      dsr: selectedDsr?.name,
      dsrId: dsrId || undefined,
      name: finalName,
      clientDistrict,
      clientSector: clientSector.trim(),
      phone: phone.trim(),
      chicks: nChicks,
      comp: nComp,
      price: nPrice,
      date,
      status: "pending",
      by: user!.email,
      zone,
      created: date,
      createdAt: nowISO(),
      history,
      plan: samedate,
      payments,
      clientId,
      currency,
      ...(applied > 0 ? { creditApplied: applied } : {}),
      ...(fullyByCredit ? { confirmedOk: true } : {}),
      ...(pickup.trim() ? { pickupLocation: pickup.trim() } : {}),
      ...(isCompany && companyName.trim() ? { companyName: companyName.trim() } : {}),
      ...(isCompany && companyTin.trim() ? { companyTin: companyTin.trim() } : {}),
      ...(isCompany && consignee.trim() ? { consignee: consignee.trim() } : {}),
      ...(isCompany && consigneePhone.trim() ? { consigneePhone: consigneePhone.trim() } : {}),
    };

    // One live order per customer per delivery date — phone is the primary key,
    // so this holds across products (matches the DB guard in place_order).
    const dupKey = normalizePhone(order.phone);
    const dupMsg = (o: Order) =>
      `${order.name} (${order.phone}) already has an order for ${formatDate(order.date)}${o.by ? ` — created by ${o.by}` : ""}. A customer can only have one order per delivery date.`;
    const dup = orders.find(
      (o) =>
        o.id !== order.id &&
        o.date === order.date &&
        o.status !== "rejected" &&
        o.status !== "refunded" &&
        (dupKey
          ? normalizePhone(o.phone) === dupKey
          : order.name.trim() !== "" &&
            o.name.trim().toLowerCase() === order.name.trim().toLowerCase())
    );
    if (dup) return setError(dupMsg(dup));

    setSaving(true);
    const res = await placeOrder(order);
    setSaving(false);
    if (!res.ok) {
      if (res.reason === "not_enough") {
        return setError(canSeeAvail
          ? `Only ${(res.left ?? 0).toLocaleString()} ${product} chicks left on ${formatDate(date)} — that just changed. Reduce the quantity or pick another day.`
          : `Not enough ${product} chicks available on ${formatDate(date)}. Please pick another day or a smaller order.`);
      }
      if (res.reason === "date_closed") return setError("That delivery date is no longer open.");
      if (res.reason === "duplicate") return setError(`${order.name} already has an order for ${formatDate(date)}. A customer can only have one order per delivery date.`);
      if (res.reason === "dup_payment") return setError(`That transaction reference${res.message ? ` (${res.message})` : ""} is already recorded on another order. Check the reference and enter the correct one.`);
      return setError("Could not place the order. Please check your connection and try again.");
    }
    // The customer registry row (stable id + friendly code) is created server-side
    // by place_order, so every order path registers the customer exactly once.

    toast(`Order created for ${order.name}.`);
    router.push("/orders");
  }

  if (!canCreate) {
    return (
      <Card>
        <p className="text-sm text-ink/70">
          Your role cannot create orders.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">

      <form onSubmit={submit} className="space-y-4">
        <Card>
          <CardHeader title="Product & location" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Product">
              {isAdmin ? (
                <Select
                  value={product}
                  placeholder="Select product"
                  options={[
                    { value: "Tetra Super Harco", label: "Tetra Super Harco" },
                    { value: "Ross 308", label: "Ross 308" },
                  ]}
                  onChange={(e) => {
                    setProduct(e.target.value as Product);
                    resetProductDependent();
                  }}
                />
              ) : (
                <Input value={product} disabled />
              )}
            </Field>

            {isTetra ? (
              <>
                <Field label="Province">
                  <Select
                    value={province}
                    placeholder="Select province"
                    options={provinceOptions}
                    onChange={(e) => {
                      setProvince(e.target.value as Province);
                      setDistrict("");
                      setDsrId("");
                      setSector("");
                    }}
                  />
                </Field>
                <Field label="District" required>
                  <Select
                    value={district}
                    placeholder={province ? "Select district" : "Choose province first"}
                    options={tetraDistrictOptions}
                    disabled={!province}
                    onChange={(e) => {
                      setDistrict(e.target.value);
                      setDsrId("");
                      setSector("");
                    }}
                  />
                </Field>
                <Field label="Registered DSR (active)">
                  <Select
                    value={dsrId}
                    placeholder={district ? "Select DSR" : "Choose district first"}
                    options={dsrOptions}
                    disabled={!district}
                    onChange={(e) => {
                      setDsrId(e.target.value);
                      setSector("");
                    }}
                  />
                </Field>
                <Field label="Sector (from DSR)" required>
                  <Select
                    value={sector}
                    placeholder={dsrId ? "Select sector" : "Choose DSR first"}
                    options={sectorOptions}
                    disabled={!dsrId}
                    onChange={(e) => setSector(e.target.value)}
                  />
                </Field>
              </>
            ) : product === "Ross 308" ? (
              <>
                <Field label="Order source">
                  <Select
                    value={rossSource}
                    options={[
                      { value: "direct", label: "No DSR — direct customer" },
                      { value: "dsr", label: "From a DSR" },
                    ]}
                    onChange={(e) => {
                      setRossSource(e.target.value as "direct" | "dsr");
                      setDsrId("");
                      setDistrict("");
                      setSector("");
                    }}
                  />
                </Field>
                {rossSource === "dsr" ? (
                  <>
                    <Field label="DSR (both zones)">
                      <Select
                        value={dsrId}
                        placeholder="Select DSR"
                        options={allDsrOptions}
                        onChange={(e) => selectRossDsr(e.target.value)}
                      />
                    </Field>
                    <Field label="District (from DSR)" required>
                      <Input value={district} disabled placeholder="Filled from the DSR" />
                    </Field>
                    <Field label="Sector (from DSR)" required>
                      <Select
                        value={sector}
                        placeholder={dsrId ? "Select sector" : "Choose DSR first"}
                        options={sectorOptions}
                        disabled={!dsrId}
                        onChange={(e) => setSector(e.target.value)}
                      />
                    </Field>
                  </>
                ) : (
                  <p className="self-end text-xs text-muted sm:col-span-2">
                    Direct customer — no DSR needed. The order uses the client&apos;s district &amp; sector entered below.
                  </p>
                )}
              </>
            ) : null}
          </div>
        </Card>

        {product && (
          <>
            <Card>
              <CardHeader title="Client & quantity" />
              {existingCustomer && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#efdfae] bg-gold-bg px-3 py-2.5 text-sm">
                  <span>
                    <strong className="text-ink">Existing customer:</strong> {existingCustomer.name}
                    {existingCustomer.code && <span className="ml-1 font-mono text-xs text-gold-dark">({existingCustomer.code})</span>}{" "}
                    <span className="text-muted">· {existingCustomer.count > 0 ? `${existingCustomer.count} order${existingCustomer.count > 1 ? "s" : ""}. This order is added to them.` : "already in your customer list."}</span>
                  </span>
                  {name.trim() !== existingCustomer.name && (
                    <Button variant="ghost" size="sm" onClick={() => setName(existingCustomer.name)}>Use “{existingCustomer.name}”</Button>
                  )}
                </div>
              )}
              {custCredit > 0 && (
                <div className="mb-4 rounded-xl border border-green/30 bg-green-bg px-3 py-2.5 text-sm text-green">
                  <strong>Customer credit: {formatRWF(custCredit)}</strong>{" "}
                  <span className="text-green/80">— applied automatically to this order (up to its total).</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Client name" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Phone" required>
                  <Input type="tel" inputMode="numeric" required value={phone} onChange={(e) => onPhoneChange(e.target.value)} placeholder="07xxxxxxxx" />
                </Field>
                <Field label="District" required>
                  <Select
                    value={clientDistrict}
                    placeholder="Select district"
                    options={ALL_DISTRICTS.map((d) => ({ value: d, label: d }))}
                    onChange={(e) => {
                      setClientDistrict(e.target.value);
                      setClientSector("");
                    }}
                  />
                </Field>
                <Field label="Sector" required>
                  <Select
                    value={clientSector}
                    placeholder={clientDistrict ? "Select sector" : "Choose district first"}
                    options={clientSectorOptions}
                    disabled={!clientDistrict}
                    onChange={(e) => setClientSector(e.target.value)}
                  />
                </Field>
                <Field label="Chicks ordered" required>
                  <Input type="number" min={1} value={chicks} onChange={(e) => setChicks(e.target.value)} />
                </Field>
                <Field label="Compensated (free) chicks">
                  <Input type="number" min={0} value={comp} onChange={(e) => setComp(e.target.value)} />
                </Field>
                <Field label="Currency" hint="Applies to the whole order — price & payments">
                  <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} options={[
                    { value: "RWF", label: "RWF — Rwandan Franc" },
                    { value: "USD", label: "USD — US Dollar" },
                    { value: "EUR", label: "EUR — Euro" },
                  ]} />
                </Field>
                <Field label={`Unit price (${currency})`} required>
                  <Input type="number" min={0} step={currency === "RWF" ? "1" : "0.01"} value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
                <Field label="Delivery date" required hint={canSeeAvail && selAvail && product ? `${remaining.toLocaleString()} ${product} chicks left this day` : undefined}>
                  {openDates.length === 0 ? (
                    <p className="text-sm text-status-refunded">No ordering dates are open. Ask the Admin to open dates on the Availability page.</p>
                  ) : (
                    <Select
                      value={date}
                      placeholder="Select an open delivery date"
                      options={openDates.map((a) => ({
                        value: a.id,
                        label: formatDate(a.date) + (canSeeAvail && product ? ` · ${availableFor(a, product as Product, orders).toLocaleString()} left` : ""),
                      }))}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Pickup location" required hint="Where the customer will collect / meet the delivery — used in delivery planning">
                  <Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="e.g. Nyabugogo taxi park" />
                </Field>
              </div>

              <div className="mt-4 rounded-xl border border-gold/30 bg-gold-bg/40 p-3.5">
                <p className="mb-2.5 text-[0.66rem] font-semibold uppercase tracking-wide text-gold-dark">Order summary</p>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Calc label="To deliver" value={`${toDeliver.toLocaleString()} chicks`} />
                  <Calc label="Free (2% + comp)" value={String(extra2 + nComp)} />
                  <Calc label="Total (charged)" value={formatMoney(total, currency)} />
                  {creditToApply > 0 && <Calc label="Credit applied" value={`− ${formatMoney(creditToApply, currency)}`} />}
                  {firstPay > 0 && <Calc label="First payment" value={`− ${formatMoney(firstPay, currency)}`} />}
                  <Calc label="Balance" value={formatMoney(orderBalance, currency)} />
                </div>
              </div>
            </Card>

            {/* Company / business details — its own card, shown when ticked */}
            <Card>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input type="checkbox" checked={isCompany} onChange={(e) => setIsCompany(e.target.checked)} />
                This is a company / business order
              </label>
              {isCompany && (
                <>
                  <p className="mb-3 mt-1 text-xs text-muted">These appear on the invoice and the payment proof.</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Company name" required><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Registered company name" /></Field>
                    <Field label="Company TIN" required><Input value={companyTin} onChange={(e) => setCompanyTin(e.target.value)} inputMode="numeric" placeholder="Tax ID number" /></Field>
                    <Field label="Consignee (person receiving)" required><Input value={consignee} onChange={(e) => setConsignee(e.target.value)} placeholder="Full name" /></Field>
                    <Field label="Consignee phone" required><Input type="tel" inputMode="numeric" value={consigneePhone} onChange={(e) => setConsigneePhone(e.target.value)} placeholder="07xxxxxxxx" /></Field>
                  </div>
                </>
              )}
            </Card>

            <Card>
              <CardHeader title="First payment (optional)" />
              <p className="mb-3 text-xs text-ink/60">
                You can record the first payment now, or add payments later.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Payment method">
                  <Select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as "MoMo" | "Bank")}
                    options={[{ value: "MoMo", label: "Mobile Money (MoMo)" }, { value: "Bank", label: "Bank transfer" }]}
                  />
                </Field>
                <Field label={`Amount (${currency})`}>
                  <Input type="number" min={0} step={currency === "RWF" ? "1" : "0.01"} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                </Field>
                <Field label="Transaction reference">
                  <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder={payMethod === "Bank" ? "Bank transfer reference" : "MoMo transaction ID"} />
                </Field>
                {payMethod === "Bank" && (
                  <>
                    <Field label="Bank name">
                      <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Bank of Kigali" />
                    </Field>
                    <Field label="Payment slip (image/PDF)">
                      <Input type="file" accept="image/*,application/pdf" onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)} />
                    </Field>
                  </>
                )}
              </div>
            </Card>
          </>
        )}

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-status-refunded">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push("/orders")}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>{saving ? "Placing…" : "Create order"}</Button>
        </div>
      </form>
    </div>
  );
}

function Calc({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink/60">{label}</p>
      <p className="font-semibold text-ink">{value}</p>
    </div>
  );
}
