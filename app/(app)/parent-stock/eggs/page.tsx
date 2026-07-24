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
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listDailyLogs, type DailyLog } from "@/lib/psDaily";
import { listHouses, type ProductionHouse } from "@/lib/psProduction";
import { listDrivers, listVehicles, type Driver, type Vehicle } from "@/lib/logistics";
import {
  EggTransferStatus, fertileBalance, listEggTransfers, newEggTransferId, nextRef, stamp, upsertEggTransfer,
  type EggTransfer,
} from "@/lib/psEggs";

const stTone = (s: EggTransferStatus) => s === "Received" ? "green" : s === "Cancelled" ? "red" : s === "Dispatched" ? "info" : "neutral";

export default function EggTransfersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [transfers, setTransfers] = useState<EggTransfer[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [houses, setHouses] = useState<ProductionHouse[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [editing, setEditing] = useState<EggTransfer | null>(null);

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";

  const load = useCallback(async () => {
    try { const [t, d, h, v, dr] = await Promise.all([listEggTransfers(), listDailyLogs(), listHouses(), listVehicles(), listDrivers()]); setTransfers(t); setDailyLogs(d); setHouses(h); setVehicles(v); setDrivers(dr); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-eggs-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["ps_egg_transfers", "ps_daily", "ps_houses"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const balance = useMemo(() => fertileBalance(dailyLogs, transfers), [dailyLogs, transfers]);
  const pending = transfers.filter((t) => t.status === "Dispatched").length;

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  async function save(t: EggTransfer) {
    setTransfers((p) => { const i = p.findIndex((x) => x.id === t.id); const c = p.slice(); if (i === -1) c.unshift(t); else c[i] = t; return c; });
    try { await upsertEggTransfer(t); toast("Egg transfer saved."); } catch { toast("Could not save.", "error"); void load(); }
    setEditing(null);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Hatchable produced" value={balance.produced.toLocaleString()} />
        <StatTile label="Transferred out" value={balance.transferred.toLocaleString()} />
        <StatTile label="Fertile eggs available" value={balance.available.toLocaleString()} tone="green" />
        <StatTile label="In transit" value={String(pending)} tone={pending > 0 ? "gold" : "default"} />
      </div>

      <Card>
        <CardHeader title={`Egg transfer orders (${transfers.length})`} action={<Button size="sm" onClick={() => setEditing({ id: newEggTransferId(), ref: nextRef("ETO", transfers), date: todayISO(), trays: 0, eggsPerTray: 30, eggQuantity: 0, status: "Draft", by: user.email, on: nowISO(), history: [stamp(user.email, "created")] })}>＋ New transfer order</Button>} />
        <TableWrap>
          <thead><tr><Th>Ref</Th><Th>Date</Th><Th>Source</Th><Th>Hatchery batch</Th><Th className="text-right">Trays</Th><Th className="text-right">Eggs</Th><Th>Vehicle · Driver</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {transfers.length === 0 ? <EmptyRow colSpan={9} text="No egg transfers yet." /> : transfers.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.ref}</Td>
                <Td>{formatDate(t.date)}</Td>
                <Td>{t.houseName || "—"}</Td>
                <Td>{t.hatcheryBatchRef || "—"}</Td>
                <Td className="text-right">{t.trays.toLocaleString()}</Td>
                <Td className="text-right">{t.eggQuantity.toLocaleString()}{t.status === "Received" && t.receivedQuantity != null && t.receivedQuantity !== t.eggQuantity ? <div className="text-xs text-red">recv {t.receivedQuantity.toLocaleString()}</div> : null}</Td>
                <Td>{t.vehicleLabel || "—"}{t.driverLabel ? ` · ${t.driverLabel}` : ""}</Td>
                <Td><Pill tone={stTone(t.status)}>{t.status}</Pill></Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Open</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">Hatchable eggs from the daily logs build the fertile-egg balance; dispatching a transfer reduces it. The hatchery confirms receipt to close the order.</p>
      </Card>

      {editing && <TransferModal key={editing.id} initial={editing} email={user.email} houses={houses.filter((h) => h.active)} vehicles={vehicles.filter((v) => v.active)} drivers={drivers.filter((d) => d.active)} available={balance.available} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function TransferModal({ initial, email, houses, vehicles, drivers, available, onClose, onSave }: {
  initial: EggTransfer; email: string; houses: ProductionHouse[]; vehicles: Vehicle[]; drivers: Driver[]; available: number;
  onClose: () => void; onSave: (t: EggTransfer) => void;
}) {
  const [t, setT] = useState<EggTransfer>(initial);
  const set = (p: Partial<EggTransfer>) => setT((x) => ({ ...x, ...p }));
  const editable = t.status === "Draft";
  const inTransit = t.status === "Dispatched";

  const setTrays = (trays: number) => set({ trays, eggQuantity: trays * (t.eggsPerTray || 0) });
  const setPerTray = (eggsPerTray: number) => set({ eggsPerTray, eggQuantity: (t.trays || 0) * eggsPerTray });

  function dispatch() {
    if (t.eggQuantity <= 0) return;
    const house = houses.find((h) => h.id === t.houseId);
    const veh = vehicles.find((v) => v.id === t.vehicleId);
    const dr = drivers.find((d) => d.id === t.driverId);
    onSave({ ...t, status: "Dispatched", dispatchTime: t.dispatchTime || nowISO(), houseName: house?.name, vehicleLabel: veh?.plate, driverLabel: dr?.name, history: [...t.history, stamp(email, "dispatched to hatchery")] });
  }
  function receive() {
    onSave({ ...t, status: "Received", receivedBy: email, receivedAt: nowISO(), receivedQuantity: t.receivedQuantity ?? t.eggQuantity, history: [...t.history, stamp(email, `received (${(t.receivedQuantity ?? t.eggQuantity).toLocaleString()} eggs)`)] });
  }

  return (
    <Modal open onClose={onClose} title={`${t.ref} · Egg transfer to hatchery`} className="max-w-2xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {editable && <Button variant="secondary" onClick={() => onSave(t)}>Save draft</Button>}
        {editable && <Button onClick={dispatch} disabled={t.eggQuantity <= 0}>Dispatch</Button>}
        {inTransit && <Button onClick={receive}>Confirm receipt</Button>}
        {editable && <button type="button" onClick={() => onSave({ ...t, status: "Cancelled", history: [...t.history, stamp(email, "cancelled")] })} className="ml-1 text-xs text-red underline">Cancel</button>}
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Pill tone={stTone(t.status)}>{t.status}</Pill></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date"><Input type="date" value={t.date} disabled={!editable} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Source production house"><Select value={t.houseId ?? ""} disabled={!editable} onChange={(e) => set({ houseId: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...houses.map((h) => ({ value: h.id, label: h.name }))]} /></Field>
          <Field label="Hatchery batch"><Input value={t.hatcheryBatchRef ?? ""} disabled={!editable} onChange={(e) => set({ hatcheryBatchRef: e.target.value })} placeholder="batch ref" /></Field>
          <div />
          <Field label="Trays"><Input type="number" min={0} value={t.trays || ""} disabled={!editable} onChange={(e) => setTrays(Number(e.target.value) || 0)} /></Field>
          <Field label="Eggs per tray"><Input type="number" min={0} value={t.eggsPerTray || ""} disabled={!editable} onChange={(e) => setPerTray(Number(e.target.value) || 0)} /></Field>
          <Field label="Total eggs"><Input type="number" min={0} value={t.eggQuantity || ""} disabled={!editable} onChange={(e) => set({ eggQuantity: Number(e.target.value) || 0 })} /></Field>
          <div />
          <Field label="Vehicle (Logistics)"><Select value={t.vehicleId ?? ""} disabled={!editable} onChange={(e) => set({ vehicleId: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...vehicles.map((v) => ({ value: v.id, label: v.plate }))]} /></Field>
          <Field label="Driver (Logistics)"><Select value={t.driverId ?? ""} disabled={!editable} onChange={(e) => set({ driverId: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...drivers.map((d) => ({ value: d.id, label: d.name }))]} /></Field>
        </div>

        {editable && t.eggQuantity > available && <p className="text-sm text-red">Only {available.toLocaleString()} fertile eggs are available — this transfer exceeds the balance.</p>}

        {inTransit && (
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Receiving confirmation (hatchery)</div>
            <Field label="Eggs received"><Input type="number" min={0} value={t.receivedQuantity ?? t.eggQuantity} onChange={(e) => set({ receivedQuantity: Number(e.target.value) || 0 })} /></Field>
          </div>
        )}
        {t.status === "Received" && <p className="text-xs text-green">Received{t.receivedAt ? ` on ${formatDate(t.receivedAt)}` : ""} — {(t.receivedQuantity ?? t.eggQuantity).toLocaleString()} eggs into the hatchery.</p>}

        <Field label="Notes"><Input value={t.notes ?? ""} disabled={t.status === "Received" || t.status === "Cancelled"} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
