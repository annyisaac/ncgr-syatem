"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  FUEL_TYPES, OWNERSHIP_TYPES, VEHICLE_TYPES, expiryState, newVehicleId, vehicleReady,
  listDrivers, listVehicles, upsertVehicle, type Driver, type ExpiryState, type Vehicle,
} from "@/lib/logistics";

const AVAILABILITY: Vehicle["availability"][] = ["Available", "On trip", "Under maintenance", "Unavailable"];

function ExpiryCell({ date }: { date?: string }) {
  const { t } = useLang();
  const state = expiryState(date, todayISO());
  if (state === "unset") return <span className="text-muted">—</span>;
  const tone = state === "expired" ? "red" : state === "soon" ? "amber" : "green";
  const label = date ? formatDate(date) : "—";
  return <Pill tone={tone}>{label}{state === "expired" ? ` · ${t("expired")}` : state === "soon" ? ` · ${t("soon")}` : ""}</Pill>;
}

export default function VehiclesPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [editing, setEditing] = useState<Vehicle | null>(null);

  const canUse = user?.role === "Admin" || user?.role === "Logistics Officer";

  const load = useCallback(async () => {
    try { const [v, d] = await Promise.all([listVehicles(), listDrivers()]); setVehicles(v); setDrivers(d); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("vehicles-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "vehicles" || p.table === "drivers") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const driverName = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers]);
  const today = todayISO();
  const ready = vehicles.filter((v) => vehicleReady(v, today)).length;
  const maint = vehicles.filter((v) => v.active && v.availability === "Under maintenance").length;
  const papersDue = vehicles.filter((v) => v.active && ([v.insuranceExpiry, v.inspectionExpiry].some((d) => {
    const s: ExpiryState = expiryState(d, today); return s === "soon" || s === "expired";
  }))).length;

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">{t("This page is for Logistics and Admin.")}</p></Card>;

  function openNew() {
    setEditing({ id: newVehicleId(), plate: "", type: VEHICLE_TYPES[0], ownership: OWNERSHIP_TYPES[0], fuelType: FUEL_TYPES[0], availability: "Available", active: true, by: user!.email, on: nowISO() });
  }
  async function save() {
    if (!editing) return;
    const clean: Vehicle = { ...editing, plate: editing.plate.trim().toUpperCase(), on: nowISO(), by: user!.email };
    if (!clean.plate) return toast(t("Enter a registration number."), "info");
    setVehicles((p) => { const i = p.findIndex((x) => x.id === clean.id); const c = p.slice(); if (i === -1) c.unshift(clean); else c[i] = clean; return c; });
    try { await upsertVehicle(clean); toast(t("Vehicle saved.")); } catch { toast(t("Could not save."), "error"); void load(); }
    setEditing(null);
  }
  const set = (patch: Partial<Vehicle>) => setEditing((e) => e ? { ...e, ...patch } : e);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("Vehicles")} value={String(vehicles.filter((v) => v.active).length)} />
        <StatTile label={t("Ready to dispatch")} value={String(ready)} tone="green" />
        <StatTile label={t("Under maintenance")} value={String(maint)} tone={maint > 0 ? "gold" : "default"} />
        <StatTile label={t("Papers due / expired")} value={String(papersDue)} tone={papersDue > 0 ? "red" : "default"} />
      </div>

      <Card>
        <CardHeader title={`${t("Fleet")} (${vehicles.filter((v) => v.active).length})`} action={<Button size="sm" onClick={openNew}>＋ {t("Add vehicle")}</Button>} />
        <TableWrap>
          <thead><tr>
            <Th>{t("Plate")}</Th><Th>{t("Type")}</Th><Th>{t("Ownership")}</Th><Th className="text-right">{t("Boxes")}</Th><Th>{t("Driver")}</Th>
            <Th>{t("Insurance")}</Th><Th>{t("Inspection")}</Th><Th>{t("Status")}</Th><Th></Th>
          </tr></thead>
          <tbody>
            {vehicles.filter((v) => v.active).length === 0 ? <EmptyRow colSpan={9} text={t("No vehicles yet — add your first.")} /> : vehicles.filter((v) => v.active).map((v) => (
              <tr key={v.id}>
                <Td className="font-medium">{v.plate}</Td>
                <Td>{v.type}</Td>
                <Td>{v.ownership}</Td>
                <Td className="text-right">{v.capacityBoxes ? v.capacityBoxes.toLocaleString() : "—"}</Td>
                <Td>{v.assignedDriverId ? (driverName.get(v.assignedDriverId) ?? "—") : "—"}</Td>
                <Td><ExpiryCell date={v.insuranceExpiry} /></Td>
                <Td><ExpiryCell date={v.inspectionExpiry} /></Td>
                <Td>{vehicleReady(v, today) ? <Pill tone="green">{t("Ready")}</Pill> : v.availability === "Under maintenance" ? <Pill tone="gold">{t("Maintenance")}</Pill> : v.availability === "On trip" ? <Pill tone="info">{t("On trip")}</Pill> : <Pill tone="neutral">{v.availability}</Pill>}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setEditing(v)}>{t("Edit")}</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && vehicles.some((v) => v.id === editing.id) ? t("Edit vehicle") : t("Add vehicle")}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>{t("Cancel")}</Button><Button onClick={save}>{t("Save vehicle")}</Button></>}>
        {editing && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("Registration number")} required><Input value={editing.plate} onChange={(e) => set({ plate: e.target.value })} placeholder="RAE 123 A" /></Field>
            <Field label={t("Type")}><Select value={editing.type} onChange={(e) => set({ type: e.target.value })} options={VEHICLE_TYPES.map((t) => ({ value: t, label: t }))} /></Field>
            <Field label={t("Ownership")}><Select value={editing.ownership} onChange={(e) => set({ ownership: e.target.value })} options={OWNERSHIP_TYPES.map((t) => ({ value: t, label: t }))} /></Field>
            <Field label={t("Fuel type")}><Select value={editing.fuelType} onChange={(e) => set({ fuelType: e.target.value })} options={FUEL_TYPES.map((t) => ({ value: t, label: t }))} /></Field>
            <Field label={t("Capacity (boxes)")}><Input type="number" min={0} value={editing.capacityBoxes ?? ""} onChange={(e) => set({ capacityBoxes: Number(e.target.value) || undefined })} /></Field>
            <Field label={t("Assigned driver")}><Select value={editing.assignedDriverId ?? ""} onChange={(e) => set({ assignedDriverId: e.target.value || undefined })} options={[{ value: "", label: t("None") }, ...drivers.filter((d) => d.active).map((d) => ({ value: d.id, label: d.name }))]} /></Field>
            <Field label={t("Insurance expiry")}><Input type="date" value={editing.insuranceExpiry ?? ""} onChange={(e) => set({ insuranceExpiry: e.target.value || undefined })} /></Field>
            <Field label={t("Inspection expiry")}><Input type="date" value={editing.inspectionExpiry ?? ""} onChange={(e) => set({ inspectionExpiry: e.target.value || undefined })} /></Field>
            <Field label={t("Current mileage (km)")}><Input type="number" min={0} value={editing.currentMileage ?? ""} onChange={(e) => set({ currentMileage: Number(e.target.value) || undefined })} /></Field>
            <Field label={t("Availability")}><Select value={editing.availability} onChange={(e) => set({ availability: e.target.value as Vehicle["availability"] })} options={AVAILABILITY.map((a) => ({ value: a, label: a }))} /></Field>
            <div className="sm:col-span-2"><Field label={t("Notes")}><Input value={editing.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} placeholder={t("optional")} /></Field></div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={editing.active} onChange={(e) => set({ active: e.target.checked })} /> {t("Active in the fleet (uncheck to retire)")}
              </label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
