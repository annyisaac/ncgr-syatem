"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TableWrap, Th, Td } from "@/components/ui/Table";
import { SearchTimeBar } from "@/components/dashboard/DashKit";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { presetToRange, type PeriodPreset } from "@/lib/period";
import { formatRWF } from "@/lib/config";
import { formatDate, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { ageWeeks, depletionPct, listFlocks, type BreederFlock } from "@/lib/parentStock";
import { cumulativeLost, listDailyLogs, logsForFlock, recentMortality, rejectEggsTotal, type DailyLog } from "@/lib/psDaily";
import { houseRatio, listHouses, listTransfers, type MaleTransfer, type ProductionHouse } from "@/lib/psProduction";
import { listHealth, type BiosecurityRec, type HealthRecord, type MedicationRec, type MortalityRec, type VaccinationRec } from "@/lib/psHealth";
import { isLow, listItems, listRequisitions, type InventoryItem, type Requisition } from "@/lib/psInventory";
import { listProductionCosts, manualCostTotal, type ProductionCost } from "@/lib/psCosting";

type Tab = "performance" | "production" | "feed" | "health" | "inventory" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "performance", label: "Flocks & houses" },
  { id: "production", label: "Egg production" },
  { id: "feed", label: "Feed, water & mortality" },
  { id: "health", label: "Health" },
  { id: "inventory", label: "Inventory & cost" },
  { id: "audit", label: "Audit trail" },
];

interface Col { key: string; label: string; align?: "right" }
function toCsv(cols: Col[], rows: Record<string, string | number>[]): string {
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\n");
}
function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
function Report({ title, cols, rows, note }: { title: string; cols: Col[]; rows: Record<string, string | number>[]; note?: string }) {
  return (
    <Card>
      <CardHeader title={`${title} (${rows.length})`} action={<Button size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => download(`${title.replace(/\s+/g, "-").toLowerCase()}.csv`, toCsv(cols, rows))}>CSV</Button>} />
      {note && <p className="-mt-1 mb-2 text-xs text-muted">{note}</p>}
      <TableWrap>
        <thead><tr>{cols.map((c) => <Th key={c.key} className={c.align === "right" ? "text-right" : ""}>{c.label}</Th>)}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={cols.length} className="p-3 text-center text-sm text-muted">Nothing to report yet.</td></tr>
          : rows.map((r, i) => <tr key={i}>{cols.map((c) => <Td key={c.key} className={c.align === "right" ? "text-right" : ""}>{r[c.key]}</Td>)}</tr>)}</tbody>
      </TableWrap>
    </Card>
  );
}

export default function ParentStockReports() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("performance");
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [houses, setHouses] = useState<ProductionHouse[]>([]);
  const [transfers, setTransfers] = useState<MaleTransfer[]>([]);
  const [health, setHealth] = useState<HealthRecord[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [reqs, setReqs] = useState<Requisition[]>([]);
  const [costs, setCosts] = useState<ProductionCost[]>([]);

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";

  const load = useCallback(async () => {
    try {
      const [f, l, h, t, he, it, r, c] = await Promise.all([listFlocks(), listDailyLogs(), listHouses(), listTransfers(), listHealth(), listItems(), listRequisitions(), listProductionCosts()]);
      setFlocks(f); setLogs(l); setHouses(h); setTransfers(t); setHealth(he); setItems(it); setReqs(r); setCosts(c);
    } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let to: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-reports-live").on("postgres_changes", { event: "*", schema: "public" }, () => { if (to) clearTimeout(to); to = setTimeout(() => void load(), 500); }).subscribe();
    return () => { if (to) clearTimeout(to); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const today = todayISO();
  const flockById = useMemo(() => new Map(flocks.map((f) => [f.id, f])), [flocks]);
  const range = useMemo(() => presetToRange(preset, custom, today), [preset, custom, today]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  // Period + search filters. Daily-log-derived totals use period-scoped logs;
  // dated records (health, costs, audit) filter by their own date.
  const noRange = !range.from && !range.to;
  const mq = q.trim().toLowerCase();
  const inP = (iso?: string) => (noRange ? true : !!iso && inRange(iso.slice(0, 10), range));
  const hit = (text: string) => !mq || text.toLowerCase().includes(mq);
  const fLogs = logs.filter((l) => inP(l.date));

  const perf = flocks.filter((f) => f.active && hit(`${f.code} ${f.breed} ${f.house ?? ""} ${f.sex}`)).map((f) => ({
    flock: f.code, sex: f.sex, breed: f.breed, house: f.house ?? "—",
    age: ageWeeks(f, today) ?? "—", placed: f.initialPopulation, current: f.currentPopulation,
    depletion: `${depletionPct(f)}%`, weight: f.bodyWeightG ?? "—", uniformity: f.uniformityPct ?? "—",
    cumMortality: cumulativeLost(fLogs, f.id),
  }));

  const houseRows = houses.filter((h) => h.active && hit(`${h.name} ${h.femaleFlockCode ?? ""}`)).map((h) => {
    const r = houseRatio(h, flockById.get(h.femaleFlockId ?? ""));
    return { house: h.name, femaleFlock: h.femaleFlockCode ?? "—", females: r.females, males: r.males, ratio: r.ratioLabel, fertility: h.fertilityPct ? `${h.fertilityPct}%` : "—", hatchability: h.hatchabilityPct ? `${h.hatchabilityPct}%` : "—" };
  });

  const eggRows = flocks.filter((f) => f.sex === "Female" && hit(f.code)).map((f) => {
    const fl = logsForFlock(fLogs, f.id);
    const eggs = fl.reduce((s, l) => s + (Number(l.eggsProduced) || 0), 0);
    const hatch = fl.reduce((s, l) => s + (Number(l.hatchableEggs) || 0), 0);
    const reject = fl.reduce((s, l) => s + rejectEggsTotal(l), 0);
    return { flock: f.code, hens: f.currentPopulation, eggs, hatchable: hatch, reject, hatchablePct: eggs > 0 ? `${Math.round((hatch / eggs) * 100)}%` : "—", rejectPct: eggs > 0 ? `${Math.round((reject / eggs) * 100)}%` : "—" };
  }).filter((r) => r.eggs > 0);

  const feedRows = flocks.filter((f) => f.active && hit(f.code)).map((f) => {
    const fl = logsForFlock(fLogs, f.id);
    const feed = fl.reduce((s, l) => s + (Number(l.feedKg) || 0), 0);
    const water = fl.reduce((s, l) => s + (Number(l.waterL) || 0), 0);
    return { flock: f.code, feedKg: Math.round(feed), feedPerBird: f.currentPopulation > 0 ? (feed / f.currentPopulation).toFixed(2) : "—", waterL: Math.round(water), mortality7d: recentMortality(logs, f.id, 7, today), cumMortality: cumulativeLost(fLogs, f.id) };
  });

  const vaccinations = health.filter((r): r is VaccinationRec => r.kind === "vaccination" && inP(r.date) && hit(`${r.vaccine} ${r.flockCode ?? ""}`)).map((v) => ({ date: formatDate(v.date), vaccine: v.vaccine, flock: v.flockCode ?? "farm", route: v.route ?? "—", batch: v.batchNo ?? "—", status: v.status }));
  const medications = health.filter((r): r is MedicationRec => r.kind === "medication" && inP(r.date) && hit(`${r.medicine} ${r.flockCode ?? ""}`)).map((m) => ({ date: formatDate(m.date), medicine: m.medicine, type: m.movement, flock: m.flockCode ?? "—", qty: m.quantity ?? "—", withdrawal: m.withdrawalUntil ? formatDate(m.withdrawalUntil) : "—" }));
  const biosecurity = health.filter((r): r is BiosecurityRec => r.kind === "biosecurity" && inP(r.date) && hit(`${r.type} ${r.location ?? ""}`)).map((b) => ({ date: formatDate(b.date), type: b.type, location: b.location ?? "—", compliant: b.compliant === false ? "No" : "Yes", incident: b.incident ? (b.severity ?? "Yes") : "—" }));
  const mortInvest = health.filter((r): r is MortalityRec => r.kind === "mortality" && inP(r.date) && hit(`${r.flockCode ?? ""} ${r.house ?? ""} ${r.cause ?? ""}`)).map((m) => ({ date: formatDate(m.date), flock: m.flockCode ?? m.house ?? "—", qty: m.quantity, cause: m.cause ?? "—", disposal: m.disposalMethod ?? "—" }));

  const invRows = items.filter((i) => i.active && hit(`${i.name} ${i.category}`)).map((i) => ({ item: i.name, category: i.category, stock: `${i.currentStock} ${i.unit}`, reorder: i.reorderLevel ?? "—", low: isLow(i) ? "LOW" : "", value: i.unitCost ? formatRWF(i.currentStock * i.unitCost) : "—" }));
  const costRows = costs.filter((c) => inP(`${c.period}-15`) && hit(c.period)).slice().sort((a, b) => (a.period < b.period ? 1 : -1)).map((c) => ({ period: c.period, operatingCost: formatRWF(manualCostTotal(c)), lines: c.lines.filter((l) => l.amount > 0).length }));

  const auditAll: { when: string; entity: string; ref: string; line: string }[] = [];
  const addAudit = (entity: string, ref: string, history?: string[]) => { for (const h of history ?? []) { const [iso, ...rest] = h.split(" · "); auditAll.push({ when: iso, entity, ref, line: rest.join(" · ") }); } };
  flocks.forEach((f) => addAudit("Flock", f.code, f.history));
  houses.forEach((h) => addAudit("House", h.name, h.history));
  transfers.forEach((t) => auditAll.push({ when: t.on, entity: "Male transfer", ref: t.ref, line: `${t.quantity} males ${t.maleFlockCode} → ${t.houseName}` }));
  reqs.forEach((r) => addAudit("Requisition", r.ref, r.history));
  const audit = auditAll.filter((a) => inP(a.when) && hit(`${a.entity} ${a.ref} ${a.line}`)).sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 300).map((r) => ({ when: r.when.replace("T", " ").slice(0, 16), entity: r.entity, ref: r.ref, line: r.line }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 sticky top-16 z-20 -mx-4 md:-mx-8 border-b border-line bg-cream/95 px-4 md:px-8 py-2.5 backdrop-blur">
        <div className="min-w-0 flex-1"><SearchTimeBar q={q} setQ={setQ} placeholder="Search these reports…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} /></div>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>Print</Button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "performance" && <div className="space-y-5">
        <Report title="Flock performance" cols={[{ key: "flock", label: "Flock" }, { key: "sex", label: "Sex" }, { key: "breed", label: "Breed" }, { key: "house", label: "House" }, { key: "age", label: "Age wk", align: "right" }, { key: "placed", label: "Placed", align: "right" }, { key: "current", label: "Current", align: "right" }, { key: "depletion", label: "Depletion", align: "right" }, { key: "weight", label: "Body wt", align: "right" }, { key: "uniformity", label: "Unif %", align: "right" }, { key: "cumMortality", label: "Cum mortality", align: "right" }]} rows={perf} />
        <Report title="Production house report" cols={[{ key: "house", label: "House" }, { key: "femaleFlock", label: "Female flock" }, { key: "females", label: "Females", align: "right" }, { key: "males", label: "Males", align: "right" }, { key: "ratio", label: "M:F ratio", align: "right" }, { key: "fertility", label: "Fertility", align: "right" }, { key: "hatchability", label: "Hatchability", align: "right" }]} rows={houseRows} />
      </div>}

      {tab === "production" && <Report title="Egg production report" note="Totals per female flock across all recorded days." cols={[{ key: "flock", label: "Flock" }, { key: "hens", label: "Hens", align: "right" }, { key: "eggs", label: "Eggs", align: "right" }, { key: "hatchable", label: "Hatchable", align: "right" }, { key: "reject", label: "Reject", align: "right" }, { key: "hatchablePct", label: "Hatchable %", align: "right" }, { key: "rejectPct", label: "Reject %", align: "right" }]} rows={eggRows} />}

      {tab === "feed" && <Report title="Feed, water & mortality" cols={[{ key: "flock", label: "Flock" }, { key: "feedKg", label: "Feed kg", align: "right" }, { key: "feedPerBird", label: "Feed/bird", align: "right" }, { key: "waterL", label: "Water L", align: "right" }, { key: "mortality7d", label: "Mortality 7d", align: "right" }, { key: "cumMortality", label: "Cum mortality", align: "right" }]} rows={feedRows} />}

      {tab === "health" && <div className="space-y-5">
        <Report title="Vaccination report" cols={[{ key: "date", label: "Date" }, { key: "vaccine", label: "Vaccine" }, { key: "flock", label: "Flock" }, { key: "route", label: "Route" }, { key: "batch", label: "Batch" }, { key: "status", label: "Status" }]} rows={vaccinations} />
        <Report title="Medication report" cols={[{ key: "date", label: "Date" }, { key: "medicine", label: "Medicine" }, { key: "type", label: "Type" }, { key: "flock", label: "Flock" }, { key: "qty", label: "Qty", align: "right" }, { key: "withdrawal", label: "Withdrawal until" }]} rows={medications} />
        <Report title="Biosecurity report" cols={[{ key: "date", label: "Date" }, { key: "type", label: "Type" }, { key: "location", label: "Location" }, { key: "compliant", label: "Compliant" }, { key: "incident", label: "Incident" }]} rows={biosecurity} />
        <Report title="Mortality investigation report" cols={[{ key: "date", label: "Date" }, { key: "flock", label: "Flock / house" }, { key: "qty", label: "Qty", align: "right" }, { key: "cause", label: "Cause" }, { key: "disposal", label: "Disposal" }]} rows={mortInvest} />
      </div>}

      {tab === "inventory" && <div className="space-y-5">
        <Report title="Inventory report" cols={[{ key: "item", label: "Item" }, { key: "category", label: "Category" }, { key: "stock", label: "Stock", align: "right" }, { key: "reorder", label: "Reorder", align: "right" }, { key: "low", label: "Flag" }, { key: "value", label: "Value", align: "right" }]} rows={invRows} />
        <Report title="Production cost report" cols={[{ key: "period", label: "Period" }, { key: "operatingCost", label: "Operating cost", align: "right" }, { key: "lines", label: "Cost lines", align: "right" }]} rows={costRows} />
      </div>}

      {tab === "audit" && <div className="space-y-3">
        <p className="text-xs text-muted">Newest 300 actions across breeder-farm records. Completed records aren&apos;t deleted; corrections go through adjustments.</p>
        <Report title="Parent stock audit trail" cols={[{ key: "when", label: "When" }, { key: "entity", label: "Record" }, { key: "ref", label: "Ref" }, { key: "line", label: "Action" }]} rows={audit} />
      </div>}
    </div>
  );
}
