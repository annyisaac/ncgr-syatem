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
import { nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  PS_BREEDS, PS_STAGES, ageWeeks, avgBodyWeight, depletion, depletionPct, listFlocks, newFlockId, stamp,
  totalsForSex, upsertFlock, type BreederFlock, type FlockStage, type Sex,
} from "@/lib/parentStock";

const stageTone = (s: FlockStage) => s === "Production" ? "green" : s === "Depleted" ? "neutral" : "info";

export function FlockRegister({ sex }: { sex: Sex }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [editing, setEditing] = useState<BreederFlock | null>(null);

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";
  const canEdit = canUse;

  const load = useCallback(async () => { try { setFlocks(await listFlocks()); } catch { /* keep */ } }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel(`ps-flocks-${sex}`).on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "ps_flocks") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load, sex]);

  const today = todayISO();
  const mine = useMemo(() => flocks.filter((f) => f.sex === sex && f.active), [flocks, sex]);
  const totals = totalsForSex(flocks, sex);
  const inLay = mine.filter((f) => f.laying).length;
  const avgWt = avgBodyWeight(mine.filter((f) => f.stage !== "Depleted"));

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  function openNew() {
    setEditing({ id: newFlockId(), code: "", sex, breed: PS_BREEDS[0], initialPopulation: 0, currentPopulation: 0, stage: "Rearing", active: true, by: user!.email, on: nowISO(), history: [] });
  }
  async function save() {
    if (!editing) return;
    const clean: BreederFlock = { ...editing, code: editing.code.trim(), on: nowISO(), by: user!.email, history: editing.history.length ? editing.history : [stamp(user!.email, "created")] };
    if (!clean.code) return toast("Enter a flock ID.", "info");
    if (clean.currentPopulation > clean.initialPopulation) return toast("Current birds can't exceed the placed population.", "info");
    setFlocks((p) => { const i = p.findIndex((x) => x.id === clean.id); const c = p.slice(); if (i === -1) c.unshift(clean); else c[i] = clean; return c; });
    try { await upsertFlock(clean); toast("Flock saved."); } catch { toast("Could not save.", "error"); void load(); }
    setEditing(null);
  }
  const set = (patch: Partial<BreederFlock>) => setEditing((e) => e ? { ...e, ...patch } : e);

  const label = sex === "Male" ? "Male breeder" : "Female breeder";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={`${label} flocks`} value={String(totals.flocks)} />
        <StatTile label="Total birds" value={totals.birds.toLocaleString()} />
        <StatTile label={sex === "Female" ? "In lay" : "In production"} value={String(inLay || mine.filter((f) => f.stage === "Production").length)} tone="green" />
        <StatTile label="Avg body weight" value={avgWt ? `${avgWt.toLocaleString()} g` : "—"} />
      </div>

      <Card>
        <CardHeader title={`${label} flocks (${mine.length})`} action={canEdit && <Button size="sm" onClick={openNew}>＋ Add flock</Button>} />
        <TableWrap>
          <thead><tr>
            <Th>Flock</Th><Th>Breed</Th><Th>House</Th><Th className="text-right">Age</Th><Th className="text-right">Placed</Th><Th className="text-right">Current</Th>
            <Th className="text-right">Depletion</Th><Th className="text-right">Body wt</Th><Th className="text-right">Unif.</Th><Th>Stage</Th><Th></Th>
          </tr></thead>
          <tbody>
            {mine.length === 0 ? <EmptyRow colSpan={11} text={`No ${label.toLowerCase()} flocks yet.`} /> : mine.map((f) => {
              const age = ageWeeks(f, today);
              return (
                <tr key={f.id}>
                  <Td className="font-medium">{f.code}{f.supplier && <div className="text-xs text-muted">{f.supplier}</div>}</Td>
                  <Td>{f.breed}</Td>
                  <Td>{f.house || "—"}</Td>
                  <Td className="text-right">{age === null ? "—" : `${age} wk`}</Td>
                  <Td className="text-right">{f.initialPopulation.toLocaleString()}</Td>
                  <Td className="text-right font-medium">{f.currentPopulation.toLocaleString()}</Td>
                  <Td className="text-right">{depletion(f).toLocaleString()} <span className="text-xs text-muted">({depletionPct(f)}%)</span></Td>
                  <Td className="text-right">{f.bodyWeightG ? `${f.bodyWeightG.toLocaleString()} g` : "—"}</Td>
                  <Td className="text-right">{f.uniformityPct ? `${f.uniformityPct}%` : "—"}</Td>
                  <Td>{f.laying ? <Pill tone="green">In lay</Pill> : <Pill tone={stageTone(f.stage)}>{f.stage}</Pill>}</Td>
                  <Td>{canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(f)}>Edit</Button>}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && flocks.some((f) => f.id === editing.id) ? `Edit ${label.toLowerCase()} flock` : `Add ${label.toLowerCase()} flock`} className="max-w-2xl"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save flock</Button></>}>
        {editing && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Flock ID" required><Input value={editing.code} onChange={(e) => set({ code: e.target.value })} placeholder={sex === "Male" ? "PS-M-2026-01" : "PS-F-2026-01"} /></Field>
            <Field label="Breed"><Select value={editing.breed} onChange={(e) => set({ breed: e.target.value })} options={PS_BREEDS.map((b) => ({ value: b, label: b }))} /></Field>
            <Field label="Supplier"><Input value={editing.supplier ?? ""} onChange={(e) => set({ supplier: e.target.value })} /></Field>
            <Field label="House"><Input value={editing.house ?? ""} onChange={(e) => set({ house: e.target.value })} /></Field>
            <Field label="Hatch date"><Input type="date" value={editing.hatchDate ?? ""} onChange={(e) => set({ hatchDate: e.target.value || undefined })} /></Field>
            <Field label="Placement date"><Input type="date" value={editing.placementDate ?? ""} onChange={(e) => set({ placementDate: e.target.value || undefined })} /></Field>
            <Field label="Placed population" required><Input type="number" min={0} value={editing.initialPopulation || ""} onChange={(e) => { const n = Number(e.target.value) || 0; set({ initialPopulation: n, ...(editing!.currentPopulation === 0 ? { currentPopulation: n } : {}) }); }} /></Field>
            <Field label="Current population"><Input type="number" min={0} value={editing.currentPopulation || ""} onChange={(e) => set({ currentPopulation: Number(e.target.value) || 0 })} /></Field>
            <Field label="Avg body weight (g)"><Input type="number" min={0} value={editing.bodyWeightG ?? ""} onChange={(e) => set({ bodyWeightG: Number(e.target.value) || undefined })} /></Field>
            <Field label="Uniformity (%)"><Input type="number" min={0} max={100} value={editing.uniformityPct ?? ""} onChange={(e) => set({ uniformityPct: Number(e.target.value) || undefined })} /></Field>
            <Field label="Stage"><Select value={editing.stage} onChange={(e) => set({ stage: e.target.value as FlockStage })} options={PS_STAGES.map((s) => ({ value: s, label: s }))} /></Field>
            {sex === "Female" && (
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!editing.laying} onChange={(e) => set({ laying: e.target.checked })} /> Laying has begun</label>
              </div>
            )}
            <div className="sm:col-span-2"><Field label="Notes"><Input value={editing.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} /></Field></div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={editing.active} onChange={(e) => set({ active: e.target.checked })} /> Active on the farm (uncheck to archive)</label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
