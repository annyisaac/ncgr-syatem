"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listJournals, upsertJournals } from "@/lib/accounting";
import {
  accumulatedDep,
  bookValue,
  currentMonth,
  depreciationEntriesToSync,
  listAssets,
  monthlyDep,
  newAssetId,
  upsertAsset,
  type FixedAsset,
} from "@/lib/fixedAssets";

export default function AssetsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const canUse = user?.role === "Admin" || user?.role === "Accountant";
  const month = currentMonth(todayISO());

  const [name, setName] = useState(""); const [category, setCategory] = useState("");
  const [date, setDate] = useState(todayISO()); const [cost, setCost] = useState("");
  const [salvage, setSalvage] = useState(""); const [life, setLife] = useState("5");

  const load = useCallback(async () => { try { setAssets(await listAssets()); } catch { /* keep */ } }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);

  useEffect(() => {
    if (!canUse) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const sb = getSupabase();
    const ch = sb.channel("assets-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "fixed_assets") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 350); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  // Auto-post monthly depreciation to the GL up to the current month.
  useEffect(() => {
    if (!canUse || assets.length === 0) return;
    (async () => { try { const j = await listJournals(); const diff = depreciationEntriesToSync(assets, month, j); if (diff.length) await upsertJournals(diff); } catch { /* retry */ } })();
  }, [assets, canUse, month]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;

  const active = assets.filter((a) => a.active);
  const totalCost = active.reduce((s, a) => s + a.cost, 0);
  const totalBook = active.reduce((s, a) => s + bookValue(a, month), 0);
  const monthlyTotal = active.reduce((s, a) => s + monthlyDep(a), 0);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !(Number(cost) > 0) || !(Number(life) > 0)) return;
    const a: FixedAsset = { id: newAssetId(), name: name.trim(), category: category.trim() || undefined, purchaseDate: date, cost: Number(cost) || 0, salvage: Number(salvage) || 0, usefulLifeYears: Number(life) || 5, active: true, by: user!.email, on: nowISO() };
    setAssets((p) => [a, ...p]);
    void upsertAsset(a).then(() => toast("Asset added.")).catch(() => { toast("Could not save.", "error"); void load(); });
    setName(""); setCategory(""); setCost(""); setSalvage(""); setLife("5");
  }
  const toggle = (a: FixedAsset) => { const n = { ...a, active: !a.active }; setAssets((p) => p.map((x) => (x.id === a.id ? n : x))); void upsertAsset(n).catch(() => void load()); };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Assets" value={String(active.length)} />
        <StatTile label="Total cost" value={formatRWF(totalCost)} />
        <StatTile label="Net book value" value={formatRWF(totalBook)} tone="green" />
        <StatTile label="Monthly depreciation" value={formatRWF(monthlyTotal)} tone={monthlyTotal ? "gold" : "default"} />
      </div>

      <Card>
        <CardHeader title="Add asset" />
        <form onSubmit={add} className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Incubator" /></Field>
          <Field label="Purchase date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Cost"><Input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          <Field label="Salvage"><Input type="number" min={0} value={salvage} onChange={(e) => setSalvage(e.target.value)} /></Field>
          <Field label="Life (yrs)"><Input type="number" min={1} value={life} onChange={(e) => setLife(e.target.value)} /></Field>
          <div className="sm:col-span-3 lg:col-span-6 flex justify-end"><Button type="submit">Add asset</Button></div>
        </form>
      </Card>

      <Card>
        <CardHeader title={`Asset register (${assets.length})`} />
        <TableWrap>
          <thead><tr><Th>Asset</Th><Th>Purchased</Th><Th className="text-right">Cost</Th><Th className="text-right">Life</Th><Th className="text-right">Monthly dep.</Th><Th className="text-right">Accum. dep.</Th><Th className="text-right">Book value</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {assets.length === 0 ? <EmptyRow colSpan={9} text="No assets yet." /> : assets.map((a) => (
              <tr key={a.id} className={a.active ? "" : "opacity-50"}>
                <Td className="font-medium">{a.name}{a.category && <div className="text-xs text-muted">{a.category}</div>}</Td>
                <Td>{formatDate(a.purchaseDate)}</Td>
                <Td className="text-right">{formatRWF(a.cost)}</Td>
                <Td className="text-right">{a.usefulLifeYears}y</Td>
                <Td className="text-right">{formatRWF(monthlyDep(a))}</Td>
                <Td className="text-right">{formatRWF(accumulatedDep(a, month))}</Td>
                <Td className="text-right font-medium text-green">{formatRWF(bookValue(a, month))}</Td>
                <Td>{a.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Disposed</Pill>}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => toggle(a)}>{a.active ? "Dispose" : "Reactivate"}</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
      <p className="text-xs text-muted">Straight-line depreciation posts monthly to the ledger automatically: Dr Depreciation Expense (6080) / Cr Accumulated Depreciation (1590), from the purchase month to the current month.</p>
    </div>
  );
}
