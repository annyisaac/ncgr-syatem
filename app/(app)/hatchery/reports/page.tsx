"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TableWrap, Th, Td } from "@/components/ui/Table";
import { StatTile, SearchTimeBar } from "@/components/dashboard/DashKit";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { presetToRange, type PeriodPreset } from "@/lib/period";
import { formatDate, todayISO } from "@/lib/format";
import { removedInStage, settableEggs } from "@/lib/hatchery/lifecycle";

const rwf = (n: number) => `${Math.round(n).toLocaleString()} RWF`;
const daysBetween = (fromIso: string, toIso: string) => Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000));
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

type Tab = "production" | "reception" | "chicks" | "inventory" | "health";
const TABS: { id: Tab; label: string }[] = [
  { id: "production", label: "Production" },
  { id: "reception", label: "Egg reception" },
  { id: "chicks", label: "Chick inventory" },
  { id: "inventory", label: "Supplies & spares" },
  { id: "health", label: "Health & biosecurity" },
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

export default function HatcheryReportsPage() {
  const { user } = useAuth();
  const { batches, receptions, inventory, supplies, spareParts, vaccinations, biosecurity, maintenance } = useHatchery();
  const [tab, setTab] = useState<Tab>("production");
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);

  const today = todayISO();
  const batchNo = useMemo(() => new Map(batches.map((b) => [b.id, b.batchNo])), [batches]);
  const range = useMemo(() => presetToRange(preset, custom, today), [preset, custom, today]);

  if (!user) return null;

  // Period + search filters (plain — report tables aren't perf-critical).
  const noRange = !range.from && !range.to;
  const mq = q.trim().toLowerCase();
  const inP = (iso?: string) => (noRange ? true : !!iso && inRange(iso, range));
  const hit = (text: string) => !mq || text.toLowerCase().includes(mq);

  const fBatches = batches.filter((b) => inP(b.setDate ?? b.createdAt) && hit(`${b.batchNo} ${b.productType} ${b.farm}`));
  const fInventory = inventory.filter((i) => i.availableCount > 0 && inP(i.hatchDate) && hit(`${batchNo.get(i.batchId) ?? ""} ${i.productType}`));

  const production = fBatches.map((b) => {
    const fertile = Math.max(0, b.eggsSet - removedInStage(b, 1) - removedInStage(b, 2));
    return {
      batch: b.batchNo, product: b.productType, farm: b.farm, setDate: b.setDate ? formatDate(b.setDate) : "—",
      eggsSet: b.eggsSet, fertile, fertility: pct(fertile, b.eggsSet),
      hatched: b.hatchedCount, hatchability: b.hatchedCount ? pct(b.hatchedCount, fertile) : "—",
      hatchOfSet: b.hatchedCount ? pct(b.hatchedCount, b.eggsSet) : "—",
      culls: b.culls, saleable: b.saleableCount, status: b.status,
    };
  });

  const reception = receptions.filter((r) => inP(r.date) && hit(`${r.farm} ${r.flockId} ${r.productType}`)).sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => ({
    date: formatDate(r.date), farm: r.farm, flock: r.flockId, product: r.productType,
    received: r.eggsReceived, cracked: r.crackedOnFarm + r.crackedOnSet, misshapen: r.misshapen, dirty: r.dirty,
    settable: settableEggs(r), ageDays: r.ageOfEggs, flockWeeks: r.ageOfFlock,
  }));

  const chicks = fInventory.slice().sort((a, b) => (a.hatchDate < b.hatchDate ? 1 : -1)).map((i) => ({
    batch: batchNo.get(i.batchId) ?? i.batchId, product: i.productType, hatchDate: formatDate(i.hatchDate),
    ageDays: daysBetween(i.hatchDate, today), available: i.availableCount,
  }));

  const supplyRows = supplies.filter((s) => hit(`${s.name} ${s.kind}`)).map((s) => {
    const last = s.purchases?.slice(-1)[0];
    return { item: s.name, category: s.kind, stock: `${s.quantity} ${s.unit}`, unitCost: last?.unitCost ? rwf(last.unitCost) : "—", value: rwf((s.purchases ?? []).reduce((a, p) => a + p.qty * p.unitCost, 0)), supplier: last?.supplier || "—" };
  });
  const spareRows = spareParts.filter((s) => hit(`${s.name} ${s.location ?? ""}`)).map((s) => ({ part: s.name, quantity: `${s.quantity} ${s.unit}`, location: s.location || "—" }));

  const vaccRows = vaccinations.filter((v) => inP(v.date) && hit(`${v.vaccine} ${batchNo.get(v.batchId) ?? ""}`)).sort((a, b) => (a.date < b.date ? 1 : -1)).map((v) => ({ date: formatDate(v.date), batch: batchNo.get(v.batchId) ?? v.batchId, vaccine: v.vaccine, doses: v.doses, by: v.administeredBy }));
  const bioRows = biosecurity.filter((l) => inP(l.on.slice(0, 10)) && hit(`${l.kind} ${l.area ?? ""} ${l.notes} ${l.staff}`)).sort((a, b) => (a.on < b.on ? 1 : -1)).map((l) => ({ date: formatDate(l.on.slice(0, 10)), kind: l.kind, area: l.area || "—", staff: l.staff, notes: l.notes }));
  const maintRows = maintenance.filter((l) => inP(l.on.slice(0, 10)) && hit(`${l.kind} ${l.area ?? ""} ${l.notes} ${l.staff}`)).sort((a, b) => (a.on < b.on ? 1 : -1)).map((l) => ({ date: formatDate(l.on.slice(0, 10)), kind: l.kind, area: l.area || "—", downtime: l.downtimeHours ?? "—", staff: l.staff, notes: l.notes }));

  // KPIs reflect the current filter.
  const totalSet = fBatches.reduce((s, b) => s + b.eggsSet, 0);
  const totalHatched = fBatches.reduce((s, b) => s + b.hatchedCount, 0);
  const totalFertile = fBatches.reduce((s, b) => s + Math.max(0, b.eggsSet - removedInStage(b, 1) - removedInStage(b, 2)), 0);
  const chicksAvail = fInventory.reduce((s, i) => s + i.availableCount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1"><SearchTimeBar q={q} setQ={setQ} placeholder="Search these reports…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} /></div>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>Print</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Eggs set" value={totalSet.toLocaleString()} />
        <StatTile label="Chicks hatched" value={totalHatched.toLocaleString()} tone="green" />
        <StatTile label="Avg hatchability" value={pct(totalHatched, totalFertile)} tone="gold" />
        <StatTile label="Chicks available" value={chicksAvail.toLocaleString()} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "production" && (
        <Report title="Batch production, fertility & hatchability" note="Filtered by set date. Fertility = fertile ÷ eggs set; hatchability = hatched ÷ fertile."
          cols={[{ key: "batch", label: "Batch" }, { key: "product", label: "Product" }, { key: "farm", label: "Farm" }, { key: "setDate", label: "Set date" }, { key: "eggsSet", label: "Eggs set", align: "right" }, { key: "fertile", label: "Fertile", align: "right" }, { key: "fertility", label: "Fertility", align: "right" }, { key: "hatched", label: "Hatched", align: "right" }, { key: "hatchability", label: "Hatchability", align: "right" }, { key: "hatchOfSet", label: "Hatch of set", align: "right" }, { key: "culls", label: "Culls", align: "right" }, { key: "saleable", label: "Saleable", align: "right" }, { key: "status", label: "Status" }]} rows={production} />
      )}
      {tab === "reception" && (
        <Report title="Egg reception" note="Filtered by reception date." cols={[{ key: "date", label: "Date" }, { key: "farm", label: "Farm" }, { key: "flock", label: "Flock" }, { key: "product", label: "Product" }, { key: "received", label: "Received", align: "right" }, { key: "cracked", label: "Cracked", align: "right" }, { key: "misshapen", label: "Misshapen", align: "right" }, { key: "dirty", label: "Dirty", align: "right" }, { key: "settable", label: "Settable", align: "right" }, { key: "ageDays", label: "Egg age (d)", align: "right" }, { key: "flockWeeks", label: "Flock (wk)", align: "right" }]} rows={reception} />
      )}
      {tab === "chicks" && (
        <Report title="Chick inventory" note="Filtered by hatch date." cols={[{ key: "batch", label: "Batch" }, { key: "product", label: "Product" }, { key: "hatchDate", label: "Hatch date" }, { key: "ageDays", label: "Age (d)", align: "right" }, { key: "available", label: "Available", align: "right" }]} rows={chicks} />
      )}
      {tab === "inventory" && <div className="space-y-5">
        <Report title="Supplies inventory" note="Current stock (search only)." cols={[{ key: "item", label: "Item" }, { key: "category", label: "Category" }, { key: "stock", label: "In stock", align: "right" }, { key: "unitCost", label: "Unit cost", align: "right" }, { key: "value", label: "Value", align: "right" }, { key: "supplier", label: "Supplier" }]} rows={supplyRows} />
        <Report title="Spare parts" note="Current stock (search only)." cols={[{ key: "part", label: "Part" }, { key: "quantity", label: "Quantity", align: "right" }, { key: "location", label: "Location" }]} rows={spareRows} />
      </div>}
      {tab === "health" && <div className="space-y-5">
        <Report title="Vaccination" cols={[{ key: "date", label: "Date" }, { key: "batch", label: "Batch" }, { key: "vaccine", label: "Vaccine" }, { key: "doses", label: "Doses", align: "right" }, { key: "by", label: "By" }]} rows={vaccRows} />
        <Report title="Biosecurity log" cols={[{ key: "date", label: "Date" }, { key: "kind", label: "Type" }, { key: "area", label: "Area" }, { key: "staff", label: "Staff" }, { key: "notes", label: "Notes" }]} rows={bioRows} />
        <Report title="Maintenance log" cols={[{ key: "date", label: "Date" }, { key: "kind", label: "Type" }, { key: "area", label: "Area" }, { key: "downtime", label: "Downtime (h)", align: "right" }, { key: "staff", label: "Staff" }, { key: "notes", label: "Notes" }]} rows={maintRows} />
      </div>}
    </div>
  );
}
