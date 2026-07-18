"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";

import type { Order, Payment, Product, Province } from "@/lib/types";
import { availableFor } from "@/lib/types";
import {
  DISTRICTS_BY_PROVINCE,
  PROVINCES,
  ALL_DISTRICTS,
  formatRWF,
  zoneDistricts,
  zoneOfDistrict,
  zoneProvinces,
} from "@/lib/config";
import { nowISO, normalizePhone, formatDate } from "@/lib/format";
import { logLine } from "@/lib/orders";

export default function NewOrderPage() {
  const { user } = useAuth();
  const { dsrs, orders, availability, placeOrder, newId } = useData();
  const { toast } = useToast();
  const router = useRouter();

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
    roleProduct ?? (isAdmin ? "" : "")
  );
  const isTetra = product === "Tetra Super Harco";

  const [province, setProvince] = useState<Province | "">("");
  const [district, setDistrict] = useState("");
  const [dsrId, setDsrId] = useState("");
  const [sector, setSector] = useState("");
  const [name, setName] = useState("");
  const [clientDistrict, setClientDistrict] = useState("");
  const [clientSector, setClientSector] = useState("");
  const [phone, setPhone] = useState("");
  const [chicks, setChicks] = useState("");
  const [comp, setComp] = useState("0");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [payAmt, setPayAmt] = useState("");
  const [payRef, setPayRef] = useState("");
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
        : DISTRICTS_BY_PROVINCE[province];
    return list.map((d) => ({ value: d, label: d }));
  }, [province, isZoneManager, user]);

  const rossDistrictOptions = useMemo(
    () => ALL_DISTRICTS.map((d) => ({ value: d, label: d })),
    []
  );

  const dsrOptions = useMemo(() => {
    if (!district) return [];
    return dsrs
      .filter((d) => d.active && d.district === district)
      .map((d) => ({ value: d.id, label: `${d.name} — ${d.phone}` }));
  }, [dsrs, district]);

  const selectedDsr = dsrs.find((d) => d.id === dsrId);
  const sectorOptions = useMemo(
    () => (selectedDsr ? selectedDsr.sectors.map((s) => ({ value: s, label: s })) : []),
    [selectedDsr]
  );

  // Customer de-duplication: a phone number already in the system is an existing
  // customer — the new order is added to them, not a new customer registration.
  const existingCustomer = useMemo(() => {
    const key = normalizePhone(phone);
    if (key.length < 6) return null;
    const theirs = orders.filter((o) => normalizePhone(o.phone) === key);
    if (theirs.length === 0) return null;
    const latest = theirs.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return { name: latest.name, count: theirs.length };
  }, [phone, orders]);

  // Ordering availability: only Admin-opened dates are selectable; remaining
  // chicks are visible to Admin & Zone Managers only.
  const canSeeAvail = user?.role === "Admin" || user?.role === "Tetra Zone Manager";
  const openDates = useMemo(
    () => availability.slice().filter((a) => a.ross > 0 || a.tetra > 0).sort((a, b) => (a.date < b.date ? -1 : 1)),
    [availability]
  );
  const selAvail = availability.find((a) => a.id === date);
  const remaining = selAvail && product ? availableFor(selAvail, product as Product, orders) : 0;

  const nChicks = Number(chicks) || 0;
  const nComp = Number(comp) || 0;
  const nPrice = Number(price) || 0;
  const extra2 = Math.round(nChicks * 0.02);
  const toDeliver = nChicks + extra2 + nComp;
  const total = nChicks * nPrice;

  function resetProductDependent() {
    setProvince("");
    setDistrict("");
    setDsrId("");
    setSector("");
  }

  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!product) return setError("Choose a product.");
    if (isTetra && !province) return setError("Choose a province.");
    if (!district) return setError("Choose a district.");
    if (isTetra && !dsrId) return setError("Choose a registered DSR.");
    if (!sector.trim()) return setError("Enter or choose a sector.");
    if (!name.trim()) return setError("Enter the client name.");
    if (phone.trim().length < 6) return setError("Enter a valid phone number.");
    if (!clientDistrict) return setError("Choose the client's district.");
    if (!clientSector.trim()) return setError("Enter the client's sector.");
    if (nChicks <= 0) return setError("Chicks must be greater than zero.");
    if (nComp < 0) return setError("Compensated chicks cannot be negative.");
    if (nPrice <= 0) return setError("Enter a unit price.");
    if (!date) return setError("Choose a delivery date.");
    if (selAvail) {
      const left = availableFor(selAvail, product as Product, orders);
      if (nChicks > left) {
        return setError(canSeeAvail
          ? `Only ${left.toLocaleString()} ${product} chicks left on ${formatDate(date)}.`
          : `Not enough ${product} chicks available on ${formatDate(date)} for this order.`);
      }
    }

    const payAmount = Number(payAmt) || 0;
    if (payAmount > 0 && !payRef.trim())
      return setError("Enter the transaction ID for the first payment.");

    const orderProvince: Province = isTetra
      ? (province as Province)
      : (PROVINCES.find((p) => DISTRICTS_BY_PROVINCE[p].includes(district)) ??
        "Eastern");
    const zone = zoneOfDistrict(district) ?? user!.zone ?? "Zone 1";

    const payments: Payment[] = [];
    const history = [logLine(user!, "Created order (Not confirmed)")];
    if (payAmount > 0) {
      payments.push({
        amt: payAmount,
        ref: payRef.trim(),
        on: nowISO(),
        by: user!.email,
        verified: false,
      });
      history.push(
        logLine(user!, `Recorded first payment ${payAmount.toLocaleString()} RWF (ref ${payRef.trim()})`)
      );
    }

    const samedate = orders.filter((o) => o.date === date).length;

    const order: Order = {
      id: newId("ord"),
      product: product as Product,
      province: orderProvince,
      district,
      sector: sector.trim(),
      dsr: selectedDsr?.name,
      dsrId: dsrId || undefined,
      name: (existingCustomer?.name ?? name).trim(),
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
    };

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
      return setError("Could not place the order. Please check your connection and try again.");
    }
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
                <Field label="District">
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
                <Field label="Sector (from DSR)">
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
                <Field label="District">
                  <Select
                    value={district}
                    placeholder="Select district"
                    options={rossDistrictOptions}
                    onChange={(e) => {
                      setDistrict(e.target.value);
                      setDsrId("");
                    }}
                  />
                </Field>
                <Field label="Sector / pickup point">
                  <Input
                    value={sector}
                    onChange={(e) => setSector(e.target.value)}
                    placeholder="Free text, e.g. Kabuga market"
                  />
                </Field>
                <Field label="DSR (optional)">
                  <Select
                    value={dsrId}
                    placeholder={district ? "None / select DSR" : "Choose district first"}
                    options={dsrOptions}
                    disabled={!district}
                    onChange={(e) => setDsrId(e.target.value)}
                  />
                </Field>
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
                    <strong className="text-ink">Existing customer:</strong> {existingCustomer.name}{" "}
                    <span className="text-muted">· {existingCustomer.count} order{existingCustomer.count > 1 ? "s" : ""}. This order is added to them.</span>
                  </span>
                  {name.trim() !== existingCustomer.name && (
                    <Button variant="ghost" size="sm" onClick={() => setName(existingCustomer.name)}>Use “{existingCustomer.name}”</Button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Client name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Phone" required>
                  <Input type="tel" inputMode="numeric" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" />
                </Field>
                <Field label="District">
                  <Select
                    value={clientDistrict}
                    placeholder="Select district"
                    options={ALL_DISTRICTS.map((d) => ({ value: d, label: d }))}
                    onChange={(e) => setClientDistrict(e.target.value)}
                  />
                </Field>
                <Field label="Sector">
                  <Input value={clientSector} onChange={(e) => setClientSector(e.target.value)} placeholder="Client's sector" />
                </Field>
                <Field label="Chicks ordered">
                  <Input type="number" min={1} value={chicks} onChange={(e) => setChicks(e.target.value)} />
                </Field>
                <Field label="Compensated (free) chicks">
                  <Input type="number" min={0} value={comp} onChange={(e) => setComp(e.target.value)} />
                </Field>
                <Field label="Unit price (RWF)">
                  <Input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
                <Field label="Delivery date" hint={canSeeAvail && selAvail && product ? `${remaining.toLocaleString()} ${product} chicks left this day` : undefined}>
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
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 rounded-md bg-ink/5 p-3 text-sm sm:grid-cols-4">
                <Calc label="2% extra (free)" value={String(extra2)} />
                <Calc label="To deliver" value={String(toDeliver)} />
                <Calc label="Total (charged)" value={formatRWF(total)} />
                <Calc label="Free chicks" value={String(extra2 + nComp)} />
              </div>
            </Card>

            <Card>
              <CardHeader title="First payment (optional)" />
              <p className="mb-3 text-xs text-ink/60">
                You can record the first payment now, or add payments later.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Amount (RWF)">
                  <Input type="number" min={0} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                </Field>
                <Field label="Transaction ID">
                  <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="e.g. MTN ref / bank ref" />
                </Field>
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
