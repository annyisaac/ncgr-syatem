"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
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
  LICENCE_CATEGORIES, driverAssignable, expiryState, newDriverId,
  listDrivers, listVehicles, upsertDriver, type Driver, type Vehicle,
} from "@/lib/logistics";

export default function DriversPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [editing, setEditing] = useState<Driver | null>(null);

  const canUse = user?.role === "Admin" || user?.role === "Logistics Officer";

  const load = useCallback(async () => {
    try { const [d, v] = await Promise.all([listDrivers(), listVehicles()]); setDrivers(d); setVehicles(v); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("drivers-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "drivers" || p.table === "vehicles") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const vehiclePlate = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles]);
  const today = todayISO();
  const active = drivers.filter((d) => d.active);
  const assignable = active.filter((d) => driverAssignable(d, today)).length;
  const licenceIssues = active.filter((d) => { const s = expiryState(d.licenceExpiry, today); return s === "expired" || s === "soon"; }).length;

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for Logistics and Admin.</p></Card>;

  function openNew() {
    setEditing({ id: newDriverId(), name: "", employment: "Employee", active: true, by: user!.email, on: nowISO() });
  }
  async function save() {
    if (!editing) return;
    const clean: Driver = { ...editing, name: editing.name.trim(), on: nowISO(), by: user!.email };
    if (!clean.name) return toast("Enter the driver's name.", "info");
    setDrivers((p) => { const i = p.findIndex((x) => x.id === clean.id); const c = p.slice(); if (i === -1) c.unshift(clean); else c[i] = clean; return c; });
    try { await upsertDriver(clean); toast("Driver saved."); } catch { toast("Could not save.", "error"); void load(); }
    setEditing(null);
  }
  const set = (patch: Partial<Driver>) => setEditing((e) => e ? { ...e, ...patch } : e);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Drivers" value={String(active.length)} />
        <StatTile label="Assignable now" value={String(assignable)} tone="green" />
        <StatTile label="Licence due / expired" value={String(licenceIssues)} tone={licenceIssues > 0 ? "red" : "default"} />
      </div>

      <Card>
        <CardHeader title={`Drivers (${active.length})`} action={<Button size="sm" onClick={openNew}>＋ Add driver</Button>} />
        <p className="-mt-1 mb-3 text-xs text-muted">A driver whose licence has expired can&apos;t be assigned to a trip.</p>
        <TableWrap>
          <thead><tr>
            <Th>Name</Th><Th>Phone</Th><Th>Licence</Th><Th>Category</Th><Th>Licence expiry</Th><Th>Vehicle</Th><Th>Status</Th><Th></Th>
          </tr></thead>
          <tbody>
            {active.length === 0 ? <EmptyRow colSpan={8} text="No drivers yet — add your first." /> : active.map((d) => {
              const state = expiryState(d.licenceExpiry, today);
              return (
                <tr key={d.id}>
                  <Td className="font-medium">{d.name}<div className="text-xs text-muted">{d.employment}</div></Td>
                  <Td>{d.phone || "—"}</Td>
                  <Td>{d.licenceNo || "—"}</Td>
                  <Td>{d.licenceCategory || "—"}</Td>
                  <Td>{d.licenceExpiry ? <Pill tone={state === "expired" ? "red" : state === "soon" ? "amber" : "green"}>{formatDate(d.licenceExpiry)}{state === "expired" ? " · expired" : state === "soon" ? " · soon" : ""}</Pill> : <span className="text-muted">—</span>}</Td>
                  <Td>{d.assignedVehicleId ? (vehiclePlate.get(d.assignedVehicleId) ?? "—") : "—"}</Td>
                  <Td>{driverAssignable(d, today) ? <Pill tone="green">Assignable</Pill> : <Pill tone="red">Blocked</Pill>}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setEditing(d)}>Edit</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && drivers.some((d) => d.id === editing.id) ? "Edit driver" : "Add driver"}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save driver</Button></>}>
        {editing && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name" required><Input value={editing.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={editing.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} placeholder="07…" /></Field>
            <Field label="Licence number"><Input value={editing.licenceNo ?? ""} onChange={(e) => set({ licenceNo: e.target.value })} /></Field>
            <Field label="Licence category"><Select value={editing.licenceCategory ?? ""} onChange={(e) => set({ licenceCategory: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...LICENCE_CATEGORIES.map((c) => ({ value: c, label: c }))]} /></Field>
            <Field label="Licence expiry"><Input type="date" value={editing.licenceExpiry ?? ""} onChange={(e) => set({ licenceExpiry: e.target.value || undefined })} /></Field>
            <Field label="Assigned vehicle"><Select value={editing.assignedVehicleId ?? ""} onChange={(e) => set({ assignedVehicleId: e.target.value || undefined })} options={[{ value: "", label: "None" }, ...vehicles.filter((v) => v.active).map((v) => ({ value: v.id, label: v.plate }))]} /></Field>
            <Field label="Employment"><Select value={editing.employment} onChange={(e) => set({ employment: e.target.value as Driver["employment"] })} options={[{ value: "Employee", label: "Employee" }, { value: "Contractor", label: "Contractor" }]} /></Field>
            <Field label="Emergency contact"><Input value={editing.emergencyContact ?? ""} onChange={(e) => set({ emergencyContact: e.target.value })} placeholder="name · phone" /></Field>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={editing.active} onChange={(e) => set({ active: e.target.checked })} /> Active (uncheck to remove from the roster)
              </label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
