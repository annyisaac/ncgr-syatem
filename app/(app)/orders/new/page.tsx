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
import {
  DISTRICTS_BY_PROVINCE,
  PROVINCES,
  ALL_DISTRICTS,
  formatRWF,
  zoneDistricts,
  zoneOfDistrict,
  zoneProvinces,
} from "@/lib/config";
import { nowISO, todayISO } from "@/lib/format";
import { logLine } from "@/lib/orders";

export default function NewOrderPage() {
  const { user } = useAuth();
  const { dsrs, orders, upsertOrder, newId } = useData();
  const { toast } = useToast();
  const router = useRouter();

  // Roles allowed to create orders.
  const roleProduct: Product | undefined =
    user?.role === "Tetra Zone Manager"
      ? "Tetra Super Harco"
      : user?.role === "Ross Order Receiver"
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
  const [date, setDate] = useState(todayISO());
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

  function submit(e: React.FormEvent) {
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
      name: name.trim(),
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

    upsertOrder(order);
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
      <h1 className="section-heading text-lg">New Order</h1>

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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Client name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Phone">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" />
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
                <Field label="Delivery date">
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
          <Button type="submit">Create order</Button>
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
