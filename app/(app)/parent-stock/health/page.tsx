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
import { listFlocks, type BreederFlock } from "@/lib/parentStock";
import {
  BIOSECURITY_TYPES, DISPOSAL_METHODS, MED_MOVEMENTS, VACCINATION_STATUSES, VACCINE_ROUTES,
  activeWithdrawals, addDays, expiringStock, listHealth, newHealthId, upsertHealth, vaccinationsDue,
  type BiosecurityRec, type HealthKind, type HealthRecord, type MedicationRec, type MortalityRec,
  type VaccinationRec, type VaccinationStatus,
} from "@/lib/psHealth";

type Tab = HealthKind;
const TABS: { id: Tab; label: string }[] = [
  { id: "vaccination", label: "Vaccination" },
  { id: "medication", label: "Medication" },
  { id: "biosecurity", label: "Biosecurity" },
  { id: "mortality", label: "Mortality investigation" },
];

export default function HealthPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [tab, setTab] = useState<Tab>("vaccination");
  const [editing, setEditing] = useState<HealthRecord | null>(null);

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";

  const load = useCallback(async () => {
    try { const [r, f] = await Promise.all([listHealth(), listFlocks()]); setRecords(r); setFlocks(f); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-health-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "ps_health" || p.table === "ps_flocks") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const today = todayISO();
  const due = useMemo(() => vaccinationsDue(records), [records]);
  const expiring = useMemo(() => expiringStock(records, today), [records, today]);
  const withdrawals = useMemo(() => activeWithdrawals(records, today), [records, today]);
  const incidents = useMemo(() => records.filter((r) => r.kind === "biosecurity" && (r as BiosecurityRec).incident).length, [records]);
  const forTab = useMemo(() => records.filter((r) => r.kind === tab).sort((a, b) => (a.date < b.date ? 1 : -1)), [records, tab]);
  const flockOpts = useMemo(() => [{ value: "", label: "— whole farm —" }, ...flocks.filter((f) => f.active).map((f) => ({ value: f.id, label: `${f.code} (${f.sex})` }))], [flocks]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  async function save(r: HealthRecord) {
    const flock = r.flockId ? flocks.find((f) => f.id === r.flockId) : undefined;
    const clean = { ...r, flockCode: flock?.code, on: nowISO(), by: user!.email } as HealthRecord;
    setRecords((p) => { const i = p.findIndex((x) => x.id === clean.id); const c = p.slice(); if (i === -1) c.unshift(clean); else c[i] = clean; return c; });
    try { await upsertHealth(clean); toast("Record saved."); } catch { toast("Could not save.", "error"); void load(); }
    setEditing(null);
  }
  function blank(kind: Tab): HealthRecord {
    const base = { id: newHealthId(kind), date: today, by: user!.email, on: nowISO() };
    if (kind === "vaccination") return { ...base, kind, vaccine: "", status: "Scheduled" };
    if (kind === "medication") return { ...base, kind, medicine: "", movement: "Treatment" };
    if (kind === "biosecurity") return { ...base, kind, type: BIOSECURITY_TYPES[0], compliant: true };
    return { ...base, kind, quantity: 0 };
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Vaccinations due" value={String(due.length)} tone={due.length > 0 ? "gold" : "default"} />
        <StatTile label="Batches expiring" value={String(expiring.length)} tone={expiring.length > 0 ? "red" : "default"} />
        <StatTile label="Active withdrawals" value={String(withdrawals.length)} tone={withdrawals.length > 0 ? "gold" : "default"} />
        <StatTile label="Biosecurity incidents" value={String(incidents)} tone={incidents > 0 ? "red" : "default"} />
      </div>

      {(due.length > 0 || expiring.length > 0 || withdrawals.length > 0) && (
        <Card className="border-gold/40">
          <CardHeader title="Reminders" />
          <div className="space-y-1 text-sm">
            {due.slice(0, 4).map((v) => <div key={v.id}>💉 <strong>{v.vaccine}</strong> due {formatDate(v.date)}{v.flockCode ? ` · ${v.flockCode}` : ""}</div>)}
            {expiring.slice(0, 4).map((e, i) => <div key={i} className={e.days < 0 ? "text-red" : ""}>⏳ {e.label} {e.days < 0 ? "expired" : `expires in ${e.days}d`} ({formatDate(e.expiry)})</div>)}
            {withdrawals.slice(0, 4).map((w) => <div key={w.id}>🚫 {w.medicine} withdrawal until {formatDate(w.withdrawalUntil!)}{w.flockCode ? ` · ${w.flockCode}` : ""}</div>)}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>{t.label}</button>
        ))}
      </div>

      <Card>
        <CardHeader title={`${TABS.find((t) => t.id === tab)!.label} (${forTab.length})`} action={<Button size="sm" onClick={() => setEditing(blank(tab))}>＋ Add record</Button>} />
        <HealthTable tab={tab} rows={forTab} onOpen={setEditing} today={today} />
      </Card>

      {editing && <HealthModal key={editing.id} initial={editing} flockOpts={flockOpts} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function HealthTable({ tab, rows, onOpen, today }: { tab: Tab; rows: HealthRecord[]; onOpen: (r: HealthRecord) => void; today: string }) {
  const editBtn = (r: HealthRecord) => <Td><Button size="sm" variant="ghost" onClick={() => onOpen(r)}>Open</Button></Td>;
  if (rows.length === 0) return <TableWrap><thead><tr><Th>Nothing yet</Th></tr></thead><tbody><EmptyRow colSpan={1} text="No records yet." /></tbody></TableWrap>;

  if (tab === "vaccination") return (
    <TableWrap>
      <thead><tr><Th>Date</Th><Th>Vaccine</Th><Th>Flock</Th><Th>Route</Th><Th>Batch</Th><Th>Expiry</Th><Th>Status</Th><Th></Th></tr></thead>
      <tbody>{(rows as VaccinationRec[]).map((r) => (
        <tr key={r.id}><Td>{formatDate(r.date)}</Td><Td className="font-medium">{r.vaccine}</Td><Td>{r.flockCode || "farm"}</Td><Td>{r.route || "—"}</Td><Td>{r.batchNo || "—"}</Td>
          <Td>{r.expiry ? <span className={r.expiry < today ? "text-red" : ""}>{formatDate(r.expiry)}</span> : "—"}</Td>
          <Td><Pill tone={r.status === "Given" ? "green" : r.status === "Missed" ? "red" : "gold"}>{r.status}</Pill></Td>{editBtn(r)}</tr>
      ))}</tbody>
    </TableWrap>
  );
  if (tab === "medication") return (
    <TableWrap>
      <thead><tr><Th>Date</Th><Th>Medicine</Th><Th>Type</Th><Th>Flock</Th><Th className="text-right">Qty</Th><Th>Withdrawal until</Th><Th></Th></tr></thead>
      <tbody>{(rows as MedicationRec[]).map((r) => (
        <tr key={r.id}><Td>{formatDate(r.date)}</Td><Td className="font-medium">{r.medicine}</Td><Td>{r.movement}</Td><Td>{r.flockCode || "—"}</Td>
          <Td className="text-right">{r.quantity ? `${r.quantity}${r.unit ? ` ${r.unit}` : ""}` : "—"}</Td>
          <Td>{r.withdrawalUntil ? <span className={r.withdrawalUntil >= today ? "text-red" : "text-muted"}>{formatDate(r.withdrawalUntil)}</span> : "—"}</Td>{editBtn(r)}</tr>
      ))}</tbody>
    </TableWrap>
  );
  if (tab === "biosecurity") return (
    <TableWrap>
      <thead><tr><Th>Date</Th><Th>Type</Th><Th>Location</Th><Th>Compliant</Th><Th>Incident</Th><Th></Th></tr></thead>
      <tbody>{(rows as BiosecurityRec[]).map((r) => (
        <tr key={r.id}><Td>{formatDate(r.date)}</Td><Td className="font-medium">{r.type}</Td><Td>{r.location || "—"}</Td>
          <Td>{r.compliant === false ? <Pill tone="red">No</Pill> : <Pill tone="green">Yes</Pill>}</Td>
          <Td>{r.incident ? <Pill tone="red">{r.severity || "Incident"}</Pill> : "—"}</Td>{editBtn(r)}</tr>
      ))}</tbody>
    </TableWrap>
  );
  return (
    <TableWrap>
      <thead><tr><Th>Date</Th><Th>Flock / house</Th><Th className="text-right">Qty</Th><Th>Cause</Th><Th>Post-mortem</Th><Th>Disposal</Th><Th></Th></tr></thead>
      <tbody>{(rows as MortalityRec[]).map((r) => (
        <tr key={r.id}><Td>{formatDate(r.date)}</Td><Td>{r.flockCode || r.house || "—"}</Td><Td className="text-right">{r.quantity.toLocaleString()}</Td>
          <Td>{r.cause || "—"}</Td><Td className="max-w-[16rem] truncate">{r.postMortem || "—"}</Td><Td>{r.disposalMethod || "—"}</Td>{editBtn(r)}</tr>
      ))}</tbody>
    </TableWrap>
  );
}

function HealthModal({ initial, flockOpts, onClose, onSave }: {
  initial: HealthRecord; flockOpts: { value: string; label: string }[]; onClose: () => void; onSave: (r: HealthRecord) => void;
}) {
  const [r, setR] = useState<HealthRecord>(initial);
  const set = (p: Partial<HealthRecord>) => setR((x) => ({ ...x, ...p } as HealthRecord));
  const title = { vaccination: "Vaccination", medication: "Medication", biosecurity: "Biosecurity", mortality: "Mortality investigation" }[r.kind];

  return (
    <Modal open onClose={onClose} title={title} className="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(r)}>Save record</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date"><Input type="date" value={r.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        {r.kind !== "biosecurity" && <Field label="Flock"><Select value={r.flockId ?? ""} onChange={(e) => set({ flockId: e.target.value || undefined })} options={flockOpts} /></Field>}

        {r.kind === "vaccination" && (() => { const v = r as VaccinationRec; return <>
          <Field label="Vaccine" required><Input value={v.vaccine} onChange={(e) => set({ vaccine: e.target.value })} /></Field>
          <Field label="Route"><Select value={v.route ?? ""} onChange={(e) => set({ route: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...VACCINE_ROUTES.map((x) => ({ value: x, label: x }))]} /></Field>
          <Field label="Batch no."><Input value={v.batchNo ?? ""} onChange={(e) => set({ batchNo: e.target.value })} /></Field>
          <Field label="Expiry"><Input type="date" value={v.expiry ?? ""} onChange={(e) => set({ expiry: e.target.value || undefined })} /></Field>
          <Field label="Doses"><Input type="number" min={0} value={v.doses ?? ""} onChange={(e) => set({ doses: Number(e.target.value) || undefined })} /></Field>
          <Field label="Age (weeks)"><Input type="number" min={0} value={v.ageWeeks ?? ""} onChange={(e) => set({ ageWeeks: Number(e.target.value) || undefined })} /></Field>
          <Field label="Status"><Select value={v.status} onChange={(e) => set({ status: e.target.value as VaccinationStatus })} options={VACCINATION_STATUSES.map((s) => ({ value: s, label: s }))} /></Field>
          <Field label="Administered by"><Input value={v.administeredBy ?? ""} onChange={(e) => set({ administeredBy: e.target.value })} /></Field>
        </>; })()}

        {r.kind === "medication" && (() => { const m = r as MedicationRec; return <>
          <Field label="Medicine" required><Input value={m.medicine} onChange={(e) => set({ medicine: e.target.value })} /></Field>
          <Field label="Type"><Select value={m.movement} onChange={(e) => set({ movement: e.target.value as MedicationRec["movement"] })} options={MED_MOVEMENTS.map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Quantity"><Input type="number" min={0} value={m.quantity ?? ""} onChange={(e) => set({ quantity: Number(e.target.value) || undefined })} /></Field>
          <Field label="Unit"><Input value={m.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} placeholder="ml, g, sachet" /></Field>
          <Field label="Reason / treatment"><Input value={m.reason ?? ""} onChange={(e) => set({ reason: e.target.value })} /></Field>
          <Field label="Withdrawal (days)"><Input type="number" min={0} value={m.withdrawalDays ?? ""} onChange={(e) => { const d = Number(e.target.value) || undefined; set({ withdrawalDays: d, withdrawalUntil: d ? addDays(m.date, d) : undefined }); }} /></Field>
          {m.withdrawalUntil && <Field label="Withdrawal until"><Input value={formatDate(m.withdrawalUntil)} disabled /></Field>}
        </>; })()}

        {r.kind === "biosecurity" && (() => { const b = r as BiosecurityRec; return <>
          <Field label="Type"><Select value={b.type} onChange={(e) => set({ type: e.target.value })} options={BIOSECURITY_TYPES.map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Location"><Input value={b.location ?? ""} onChange={(e) => set({ location: e.target.value })} /></Field>
          <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={b.compliant !== false} onChange={(e) => set({ compliant: e.target.checked })} /> Compliant</label></div>
          <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!b.incident} onChange={(e) => set({ incident: e.target.checked })} /> This is an incident</label></div>
          {b.incident && <Field label="Severity"><Select value={b.severity ?? ""} onChange={(e) => set({ severity: e.target.value || undefined })} options={[{ value: "", label: "—" }, { value: "Low", label: "Low" }, { value: "Medium", label: "Medium" }, { value: "High", label: "High" }]} /></Field>}
          {b.incident && <div className="sm:col-span-2"><Field label="Action taken"><Input value={b.actionTaken ?? ""} onChange={(e) => set({ actionTaken: e.target.value })} /></Field></div>}
        </>; })()}

        {r.kind === "mortality" && (() => { const m = r as MortalityRec; return <>
          <Field label="House"><Input value={m.house ?? ""} onChange={(e) => set({ house: e.target.value })} /></Field>
          <Field label="Quantity" required><Input type="number" min={0} value={m.quantity || ""} onChange={(e) => set({ quantity: Number(e.target.value) || 0 })} /></Field>
          <Field label="Age (weeks)"><Input type="number" min={0} value={m.ageWeeks ?? ""} onChange={(e) => set({ ageWeeks: Number(e.target.value) || undefined })} /></Field>
          <Field label="Cause"><Input value={m.cause ?? ""} onChange={(e) => set({ cause: e.target.value })} /></Field>
          <Field label="Disposal method"><Select value={m.disposalMethod ?? ""} onChange={(e) => set({ disposalMethod: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...DISPOSAL_METHODS.map((x) => ({ value: x, label: x }))]} /></Field>
          <div className="sm:col-span-2"><Field label="Post-mortem findings"><Input value={m.postMortem ?? ""} onChange={(e) => set({ postMortem: e.target.value })} /></Field></div>
        </>; })()}

        <div className="sm:col-span-2"><Field label="Notes"><Input value={r.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} /></Field></div>
      </div>
    </Modal>
  );
}
