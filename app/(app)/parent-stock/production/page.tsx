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
import { listFlocks, upsertFlock, type BreederFlock } from "@/lib/parentStock";
import {
  RATIO_MAX_MALE_PCT, RATIO_MIN_MALE_PCT, houseRatio, listHouses, listTransfers, newHouseId, newTransferId,
  nextRef, stamp, upsertHouse, upsertTransfer, type MaleTransfer, type ProductionHouse,
} from "@/lib/psProduction";

type Tab = "houses" | "transfers";

export default function ProductionPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [houses, setHouses] = useState<ProductionHouse[]>([]);
  const [transfers, setTransfers] = useState<MaleTransfer[]>([]);
  const [tab, setTab] = useState<Tab>("houses");
  const [houseEdit, setHouseEdit] = useState<ProductionHouse | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";

  const load = useCallback(async () => {
    try { const [f, h, t] = await Promise.all([listFlocks(), listHouses(), listTransfers()]); setFlocks(f); setHouses(h); setTransfers(t); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-production-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["ps_houses", "ps_transfers", "ps_flocks"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const flockById = useMemo(() => new Map(flocks.map((f) => [f.id, f])), [flocks]);
  const femaleFlocks = useMemo(() => flocks.filter((f) => f.active && f.sex === "Female" && f.stage !== "Depleted"), [flocks]);
  const maleFlocks = useMemo(() => flocks.filter((f) => f.active && f.sex === "Male" && f.stage !== "Depleted" && f.currentPopulation > 0), [flocks]);
  const activeHouses = useMemo(() => houses.filter((h) => h.active), [houses]);

  const totalMales = activeHouses.reduce((s, h) => s + h.malePopulation, 0);
  const totalFemales = activeHouses.reduce((s, h) => s + (flockById.get(h.femaleFlockId ?? "")?.currentPopulation ?? 0), 0);
  const ratioAlerts = activeHouses.filter((h) => { const r = houseRatio(h, flockById.get(h.femaleFlockId ?? "")); return r.state === "low" || r.state === "high"; }).length;

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  async function saveHouse(h: ProductionHouse) {
    setHouses((p) => { const i = p.findIndex((x) => x.id === h.id); const c = p.slice(); if (i === -1) c.unshift(h); else c[i] = h; return c; });
    try { await upsertHouse(h); toast("House saved."); } catch { toast("Could not save.", "error"); void load(); }
    setHouseEdit(null);
  }

  async function recordTransfer(t: MaleTransfer) {
    const male = flocks.find((f) => f.id === t.maleFlockId);
    const house = houses.find((h) => h.id === t.houseId);
    if (!male || !house) return;
    const removed = t.quantity + t.mortality;
    if (removed > male.currentPopulation) return toast("Not enough birds in the male flock.", "error");
    const updatedMale: BreederFlock = { ...male, currentPopulation: Math.max(0, male.currentPopulation - removed), transferredOut: (male.transferredOut || 0) + removed };
    const updatedHouse: ProductionHouse = { ...house, malePopulation: house.malePopulation + t.quantity, history: [...house.history, stamp(user!.email, `+${t.quantity} males from ${male.code}`)] };
    setTransfers((p) => [t, ...p]);
    setFlocks((p) => p.map((f) => f.id === updatedMale.id ? updatedMale : f));
    setHouses((p) => p.map((h) => h.id === updatedHouse.id ? updatedHouse : h));
    try {
      await Promise.all([upsertTransfer(t), upsertFlock(updatedMale), upsertHouse(updatedHouse)]);
      toast(`Transferred ${t.quantity} males into ${house.name}.`);
    } catch { toast("Could not record transfer.", "error"); void load(); }
    setTransferOpen(false);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Production houses" value={String(activeHouses.length)} />
        <StatTile label="Males in houses" value={totalMales.toLocaleString()} />
        <StatTile label="Females in houses" value={totalFemales.toLocaleString()} />
        <StatTile label="Ratio alerts" value={String(ratioAlerts)} tone={ratioAlerts > 0 ? "red" : "default"} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {(["houses", "transfers"] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>
            {t === "houses" ? "Production houses" : "Male transfers"}
          </button>
        ))}
      </div>

      {tab === "houses" && (
        <Card>
          <CardHeader title={`Production houses (${activeHouses.length})`} action={<Button size="sm" onClick={() => setHouseEdit({ id: newHouseId(), name: "", malePopulation: 0, active: true, by: user.email, on: nowISO(), history: [stamp(user.email, "created")] })}>＋ New house</Button>} />
          <TableWrap>
            <thead><tr><Th>House</Th><Th>Female flock</Th><Th className="text-right">Females</Th><Th className="text-right">Males</Th><Th className="text-right">M:F ratio</Th><Th className="text-right">Fertility</Th><Th className="text-right">Hatchability</Th><Th></Th></tr></thead>
            <tbody>
              {activeHouses.length === 0 ? <EmptyRow colSpan={8} text="No production houses yet." /> : activeHouses.map((h) => {
                const fem = flockById.get(h.femaleFlockId ?? "");
                const r = houseRatio(h, fem);
                return (
                  <tr key={h.id}>
                    <Td className="font-medium">{h.name}</Td>
                    <Td>{h.femaleFlockCode || "—"}</Td>
                    <Td className="text-right">{r.females.toLocaleString()}</Td>
                    <Td className="text-right">{r.males.toLocaleString()}</Td>
                    <Td className="text-right">{r.state === "none" ? "—" : <span className="inline-flex items-center gap-1">{r.ratioLabel}{r.state !== "ok" && <Pill tone="red">{r.state === "low" ? "too few males" : "too many males"}</Pill>}</span>}</Td>
                    <Td className="text-right">{h.fertilityPct ? `${h.fertilityPct}%` : "—"}</Td>
                    <Td className="text-right">{h.hatchabilityPct ? `${h.hatchabilityPct}%` : "—"}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => setHouseEdit(h)}>Edit</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs text-muted">Company standard is {RATIO_MIN_MALE_PCT}–{RATIO_MAX_MALE_PCT}% males (about 1 male per 8–12 females). Fertility &amp; hatchability are recorded here now; hatchery candling can feed them later.</p>
        </Card>
      )}

      {tab === "transfers" && (
        <Card>
          <CardHeader title={`Male transfers (${transfers.length})`} action={<Button size="sm" onClick={() => setTransferOpen(true)} disabled={maleFlocks.length === 0 || activeHouses.length === 0}>＋ Transfer males</Button>} />
          <TableWrap>
            <thead><tr><Th>Ref</Th><Th>Date</Th><Th>From male flock</Th><Th>To house</Th><Th className="text-right">Qty</Th><Th className="text-right">Transit deaths</Th><Th>Reason</Th></tr></thead>
            <tbody>
              {transfers.length === 0 ? <EmptyRow colSpan={7} text="No transfers yet. Move males into a production house to begin breeding." /> : transfers.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.ref}</Td>
                  <Td>{formatDate(t.date)}</Td>
                  <Td>{t.maleFlockCode}</Td>
                  <Td>{t.houseName}</Td>
                  <Td className="text-right">{t.quantity.toLocaleString()}</Td>
                  <Td className="text-right">{t.mortality ? t.mortality.toLocaleString() : "—"}</Td>
                  <Td>{t.reason || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs text-muted">Transfers are permanent history. Recording one reduces the male flock and grows the house&apos;s male population.</p>
        </Card>
      )}

      {houseEdit && (
        <HouseModal key={houseEdit.id} initial={houseEdit} femaleFlocks={femaleFlocks} onClose={() => setHouseEdit(null)} onSave={saveHouse} />
      )}
      {transferOpen && (
        <TransferModal maleFlocks={maleFlocks} houses={activeHouses} email={user.email} nextRefValue={nextRef("TRF-M", transfers)} onClose={() => setTransferOpen(false)} onSave={recordTransfer} />
      )}
    </div>
  );
}

function HouseModal({ initial, femaleFlocks, onClose, onSave }: {
  initial: ProductionHouse; femaleFlocks: BreederFlock[]; onClose: () => void; onSave: (h: ProductionHouse) => void;
}) {
  const [h, setH] = useState<ProductionHouse>(initial);
  const set = (p: Partial<ProductionHouse>) => setH((x) => ({ ...x, ...p }));

  function save() {
    if (!h.name.trim()) return;
    const fem = femaleFlocks.find((f) => f.id === h.femaleFlockId);
    onSave({ ...h, name: h.name.trim(), femaleFlockCode: fem?.code });
  }

  return (
    <Modal open onClose={onClose} title={initial.name ? "Edit production house" : "New production house"} className="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save house</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="House name" required><Input value={h.name} onChange={(e) => set({ name: e.target.value })} placeholder="Production House 1" /></Field></div>
        <div className="sm:col-span-2"><Field label="Female breeder flock"><Select value={h.femaleFlockId ?? ""} onChange={(e) => set({ femaleFlockId: e.target.value || undefined })} options={[{ value: "", label: "None yet" }, ...femaleFlocks.map((f) => ({ value: f.id, label: `${f.code} — ${f.currentPopulation.toLocaleString()} hens` }))]} /></Field></div>
        <Field label="Fertility (%)"><Input type="number" min={0} max={100} value={h.fertilityPct ?? ""} onChange={(e) => set({ fertilityPct: Number(e.target.value) || undefined })} /></Field>
        <Field label="Hatchability (%)"><Input type="number" min={0} max={100} value={h.hatchabilityPct ?? ""} onChange={(e) => set({ hatchabilityPct: Number(e.target.value) || undefined })} /></Field>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={h.active} onChange={(e) => set({ active: e.target.checked })} /> Active</label>
        </div>
      </div>
    </Modal>
  );
}

function TransferModal({ maleFlocks, houses, email, nextRefValue, onClose, onSave }: {
  maleFlocks: BreederFlock[]; houses: ProductionHouse[]; email: string; nextRefValue: string; onClose: () => void; onSave: (t: MaleTransfer) => void;
}) {
  const [maleFlockId, setMaleFlockId] = useState(maleFlocks[0]?.id ?? "");
  const [houseId, setHouseId] = useState(houses[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [quantity, setQuantity] = useState(0);
  const [mortality, setMortality] = useState(0);
  const [reason, setReason] = useState("");

  const male = maleFlocks.find((f) => f.id === maleFlockId);
  const house = houses.find((h) => h.id === houseId);
  const removed = quantity + mortality;
  const over = male ? removed > male.currentPopulation : false;

  function save() {
    if (!male || !house || quantity <= 0) return;
    onSave({ id: newTransferId(), ref: nextRefValue, maleFlockId, maleFlockCode: male.code, houseId, houseName: house.name, date, quantity, mortality, reason: reason.trim() || undefined, by: email, on: nowISO() });
  }

  return (
    <Modal open onClose={onClose} title="Transfer males into a production house" className="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!male || !house || quantity <= 0 || over}>Record transfer</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Male flock"><Select value={maleFlockId} onChange={(e) => setMaleFlockId(e.target.value)} options={maleFlocks.map((f) => ({ value: f.id, label: `${f.code} — ${f.currentPopulation.toLocaleString()} males` }))} /></Field>
        <Field label="Destination house"><Select value={houseId} onChange={(e) => setHouseId(e.target.value)} options={houses.map((h) => ({ value: h.id, label: h.name }))} /></Field>
        <Field label="Transfer date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Males transferred" required><Input type="number" min={0} value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value) || 0)} /></Field>
        <Field label="Died in transit"><Input type="number" min={0} value={mortality || ""} onChange={(e) => setMortality(Number(e.target.value) || 0)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. start of production" /></Field>
      </div>
      {over && <p className="mt-3 text-sm text-red">That&apos;s more than the {male?.currentPopulation.toLocaleString()} males available.</p>}
      {male && house && quantity > 0 && !over && (
        <p className="mt-3 text-xs text-muted">{male.code} → {male.currentPopulation.toLocaleString()} − {removed.toLocaleString()} = {(male.currentPopulation - removed).toLocaleString()} left · {house.name} males {house.malePopulation.toLocaleString()} → {(house.malePopulation + quantity).toLocaleString()}.</p>
      )}
    </Modal>
  );
}
