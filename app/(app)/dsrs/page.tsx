"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { LineChartView } from "@/components/charts/Charts";

import type { DSR, Province } from "@/lib/types";
import {
  DISTRICTS_BY_PROVINCE,
  PROVINCES,
  formatRWF,
  zoneDistricts,
  zoneOfDistrict,
  zoneProvinces,
} from "@/lib/config";
import { visibleOrders } from "@/lib/permissions";
import { commissionByDSR } from "@/lib/commission";

const schema = z.object({
  name: z.string().min(2, "Enter the DSR's full name."),
  phone: z.string().min(6, "Enter a valid phone number."),
  province: z.string().min(1, "Choose a province."),
  district: z.string().min(1, "Choose a district."),
  sectors: z.string().min(1, "Enter at least one sector."),
});
type FormValues = z.infer<typeof schema>;

export default function DSRsPage() {
  const { user } = useAuth();
  const { dsrs, orders, upsertDSR, newId } = useData();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);

  const isZoneManager = user?.role === "Tetra Zone Manager";

  // DSRs visible to this user.
  const myDSRs = useMemo(() => {
    if (!user) return [];
    if (isZoneManager) return dsrs.filter((d) => d.zone === user.zone);
    return dsrs;
  }, [dsrs, user, isZoneManager]);

  // Orders visible to this user (for analytics).
  const myOrders = useMemo(
    () => (user ? visibleOrders(orders, user) : []),
    [orders, user]
  );

  // Provinces available for registration (zone-limited for zone managers).
  const provinceOptions = useMemo(() => {
    const list =
      isZoneManager && user?.zone ? zoneProvinces(user.zone) : PROVINCES;
    return list.map((p) => ({ value: p, label: p }));
  }, [isZoneManager, user]);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", phone: "", province: "", district: "", sectors: "" },
  });

  const province = watch("province") as Province | "";
  const districtOptions = useMemo(() => {
    if (!province) return [];
    const list =
      isZoneManager && user?.zone
        ? zoneDistricts(user.zone, province)
        : DISTRICTS_BY_PROVINCE[province];
    return list.map((d) => ({ value: d, label: d }));
  }, [province, isZoneManager, user]);

  function onSubmit(values: FormValues) {
    const zone = zoneOfDistrict(values.district);
    if (!zone) {
      toast("Could not determine the zone for that district.", "error");
      return;
    }
    const sectors = values.sectors
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const dsr: DSR = {
      id: newId("dsr"),
      name: values.name.trim(),
      phone: values.phone.trim(),
      province: values.province as Province,
      district: values.district,
      sectors,
      zone,
      active: true,
      by: user!.email,
    };
    upsertDSR(dsr);
    toast(`Registered ${dsr.name}.`);
    reset();
    setShowForm(false);
  }

  function toggleActive(dsr: DSR) {
    upsertDSR({ ...dsr, active: !dsr.active });
    toast(`${dsr.name} ${dsr.active ? "deactivated" : "activated"}.`);
  }

  // ---- Analytics -----------------------------------------------------------
  const chicksByDsr = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of myOrders) {
      if (!o.dsrId || o.status === "refunded" || o.status === "rejected") continue;
      map.set(o.dsrId, (map.get(o.dsrId) ?? 0) + o.chicks);
    }
    return map;
  }, [myOrders]);

  const activeDSRs = myDSRs.filter((d) => d.active);
  const districtsCovered = new Set(activeDSRs.map((d) => d.district)).size;

  const bestDSR = useMemo(() => {
    let best: { name: string; chicks: number } | null = null;
    for (const d of myDSRs) {
      const c = chicksByDsr.get(d.id) ?? 0;
      if (c > 0 && (!best || c > best.chicks)) best = { name: d.name, chicks: c };
    }
    return best;
  }, [myDSRs, chicksByDsr]);

  const commissionRows = useMemo(() => commissionByDSR(myOrders), [myOrders]);
  const toBeGiven = commissionRows.reduce(
    (s, r) => s + r.dueAmount + r.initiatedAmount,
    0
  );
  const given = commissionRows.reduce((s, r) => s + r.paidAmount, 0);

  const dsrsPerDistrict = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of activeDSRs) map.set(d.district, (map.get(d.district) ?? 0) + 1);
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [activeDSRs]);

  const topDSRs = useMemo(() => {
    return myDSRs
      .map((d) => ({ label: d.name, value: chicksByDsr.get(d.id) ?? 0 }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [myDSRs, chicksByDsr]);

  const dsrName = (id: string) => myDSRs.find((d) => d.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">
          {isZoneManager ? "My DSRs" : "DSR Registry"}
        </h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Hide form" : "Register new DSR"}
        </Button>
      </div>

      {/* Register form */}
      {showForm && (
        <Card>
          <CardHeader title="Register new DSR" />
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <Field label="Full name" error={errors.name?.message}>
              <Input {...register("name")} placeholder="e.g. Jean Bosco" />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input {...register("phone")} placeholder="e.g. 0788123456" />
            </Field>
            <Field label="Province" error={errors.province?.message}>
              <Select
                {...register("province")}
                placeholder="Select province"
                options={provinceOptions}
                onChange={(e) => {
                  setValue("province", e.target.value);
                  setValue("district", "");
                }}
              />
            </Field>
            <Field label="District" error={errors.district?.message}>
              <Select
                {...register("district")}
                placeholder={province ? "Select district" : "Choose province first"}
                options={districtOptions}
                disabled={!province}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Sectors (comma-separated)"
                hint="One DSR can cover many sectors, e.g. Gishari, Munyaga, Nyakariro"
                error={errors.sectors?.message}
              >
                <Input {...register("sectors")} placeholder="Gishari, Munyaga" />
              </Field>
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { reset(); setShowForm(false); }}>
                Cancel
              </Button>
              <Button type="submit">Save DSR</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Dashboard stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total DSRs" value={String(myDSRs.length)} />
        <Stat label="Active" value={String(activeDSRs.length)} />
        <Stat label="Districts covered" value={String(districtsCovered)} />
        <Stat label="Best performer" value={bestDSR ? bestDSR.name : "—"} sub={bestDSR ? `${bestDSR.chicks} chicks` : ""} />
        <Stat label="Commission to give" value={formatRWF(toBeGiven)} />
        <Stat label="Commission given" value={formatRWF(given)} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="DSRs per district" />
          <LineChartView data={dsrsPerDistrict} valueName="DSRs" />
        </Card>
        <Card>
          <CardHeader title="Top 5 DSRs by chicks sold" />
          <LineChartView data={topDSRs} color="#1565c0" valueName="Chicks" />
        </Card>
      </div>

      {/* Commission table */}
      <Card>
        <CardHeader title="Commission by DSR" />
        <TableWrap>
          <thead>
            <tr>
              <Th>DSR</Th>
              <Th>District</Th>
              <Th>Product</Th>
              <Th className="text-right">Chicks</Th>
              <Th className="text-right">Commission</Th>
              <Th className="text-right">To give</Th>
              <Th className="text-right">Given</Th>
            </tr>
          </thead>
          <tbody>
            {commissionRows.length === 0 ? (
              <EmptyRow colSpan={7} text="No commission yet." />
            ) : (
              commissionRows.map((r) => (
                <tr key={r.dsrId}>
                  <Td>
                    <Link href={`/dsrs/${r.dsrId}`} className="text-gold-dark underline underline-offset-2">
                      {dsrName(r.dsrId)}
                    </Link>
                  </Td>
                  <Td>{r.district}</Td>
                  <Td>{r.product}</Td>
                  <Td className="text-right">{r.chicks.toLocaleString()}</Td>
                  <Td className="text-right">{formatRWF(r.amount)}</Td>
                  <Td className="text-right">{formatRWF(r.dueAmount + r.initiatedAmount)}</Td>
                  <Td className="text-right">{formatRWF(r.paidAmount)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>

      {/* DSR list */}
      <Card>
        <CardHeader title="Registered DSRs" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th>Province</Th>
              <Th>District</Th>
              <Th>Zone</Th>
              <Th>Sectors</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {myDSRs.length === 0 ? (
              <EmptyRow colSpan={8} text="No DSRs registered yet." />
            ) : (
              myDSRs.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <Link href={`/dsrs/${d.id}`} className="font-medium text-gold-dark underline underline-offset-2">
                      {d.name}
                    </Link>
                  </Td>
                  <Td>{d.phone}</Td>
                  <Td>{d.province}</Td>
                  <Td>{d.district}</Td>
                  <Td>{d.zone}</Td>
                  <Td className="max-w-[16rem] truncate" >{d.sectors.join(", ")}</Td>
                  <Td>
                    {d.active ? (
                      <Pill tone="fulfilled">Active</Pill>
                    ) : (
                      <Pill tone="neutral">Inactive</Pill>
                    )}
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant={d.active ? "ghost" : "primary"}
                      onClick={() => toggleActive(d)}
                    >
                      {d.active ? "Deactivate" : "Activate"}
                    </Button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-ink/60">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink leading-tight">{value}</p>
      {sub && <p className="text-xs text-ink/50">{sub}</p>}
    </Card>
  );
}
