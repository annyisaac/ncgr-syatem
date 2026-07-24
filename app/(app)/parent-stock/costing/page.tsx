"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listFlocks, totalsForSex, type BreederFlock } from "@/lib/parentStock";
import { listDailyLogs, type DailyLog } from "@/lib/psDaily";
import { listItems, listMoves, type InventoryItem, type StockMove } from "@/lib/psInventory";
import {
  PROD_COST_CATEGORIES, listProductionCosts, manualCostTotal, upsertProductionCost,
  type ProductionCost, type ProductionCostLine,
} from "@/lib/psCosting";

const round0 = (n: number) => Math.round(n);
const recentMonths = (n: number) => {
  const out: string[] = []; const d = new Date();
  for (let i = 0; i < n; i++) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`); }
  return out;
};

export default function ProductionCostingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [costs, setCosts] = useState<ProductionCost[]>([]);
  const [period, setPeriod] = useState(todayISO().slice(0, 7));

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";

  const load = useCallback(async () => {
    try { const [f, l, it, mv, c] = await Promise.all([listFlocks(), listDailyLogs(), listItems(), listMoves(), listProductionCosts()]); setFlocks(f); setLogs(l); setItems(it); setMoves(mv); setCosts(c); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-costing-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["ps_costs", "ps_daily", "ps_inventory", "ps_stock_moves", "ps_flocks"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const sheet = useMemo(() => costs.find((c) => c.period === period), [costs, period]);
  const [draftLines, setDraftLines] = useState<ProductionCostLine[]>([]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraftLines(sheet?.lines ?? PROD_COST_CATEGORIES.map((c) => ({ category: c.key, amount: 0 }))); }, [sheet, period]);

  // Auto-collected costs for the period (already booked — for the unit-cost calc).
  const monthLogs = useMemo(() => logs.filter((l) => l.date.slice(0, 7) === period), [logs, period]);
  const feedKg = monthLogs.reduce((s, l) => s + (Number(l.feedKg) || 0), 0);
  const feedItems = items.filter((i) => i.category === "Feed" && i.unitCost);
  const feedUnitCost = feedItems.length ? feedItems.reduce((s, i) => s + (i.unitCost || 0), 0) / feedItems.length : 0;
  const feedCost = round0(feedKg * feedUnitCost);
  const inventoryIssued = useMemo(() => moves.filter((m) => m.type === "Issue" && m.date.slice(0, 7) === period)
    .reduce((s, m) => s + m.quantity * (itemById.get(m.itemId)?.unitCost || 0), 0), [moves, period, itemById]);
  const fertileEggs = monthLogs.reduce((s, l) => s + (Number(l.hatchableEggs) || 0), 0);

  const males = totalsForSex(flocks, "Male");
  const females = totalsForSex(flocks, "Female");
  const birds = males.birds + females.birds;
  const flockCount = flocks.filter((f) => f.active && f.stage !== "Depleted").length;

  const manualTotal = manualCostTotal({ lines: draftLines });
  const total = feedCost + round0(inventoryIssued) + manualTotal;
  const per = (n: number) => (n > 0 ? formatRWF(round0(total / n)) : "—");

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  const setLine = (i: number, amount: number) => setDraftLines((p) => p.map((l, x) => x === i ? { ...l, amount } : l));
  async function save() {
    const clean: ProductionCost = { id: period, period, lines: draftLines.filter((l) => (Number(l.amount) || 0) !== 0), by: user!.email, on: nowISO() };
    setCosts((p) => { const i = p.findIndex((x) => x.id === clean.id); const c = p.slice(); if (i === -1) c.unshift(clean); else c[i] = clean; return c; });
    try { await upsertProductionCost(clean); toast("Cost sheet saved — operating costs will post to Finance."); } catch { toast("Could not save.", "error"); void load(); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Gather the period&apos;s costs to work out cost per bird and per fertile egg. Operating costs post to Finance; feed &amp; issued stock are already booked.</p>
        <div className="w-40"><Field label="Period"><Select value={period} onChange={(e) => setPeriod(e.target.value)} options={recentMonths(12).map((m) => ({ value: m, label: m }))} /></Field></div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total production cost" value={formatRWF(total)} tone="gold" />
        <StatTile label="Cost / bird" value={per(birds)} />
        <StatTile label="Cost / male" value={per(males.birds)} />
        <StatTile label="Cost / female" value={per(females.birds)} />
        <StatTile label="Cost / fertile egg" value={per(fertileEggs)} tone="green" />
        <StatTile label="Cost / flock" value={per(flockCount)} />
      </div>

      <Card>
        <CardHeader title="Already booked (for the cost calc)" />
        <TableWrap>
          <thead><tr><Th>Source</Th><Th className="text-right">Amount</Th><Th>Basis</Th></tr></thead>
          <tbody>
            <tr><Td className="font-medium">Feed</Td><Td className="text-right">{formatRWF(feedCost)}</Td><Td>{feedKg.toLocaleString()} kg × avg {formatRWF(round0(feedUnitCost))}/kg (daily logs)</Td></tr>
            <tr><Td className="font-medium">Vaccines, medicines & supplies issued</Td><Td className="text-right">{formatRWF(round0(inventoryIssued))}</Td><Td>stock issues in {period}</Td></tr>
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">These were booked to the ledger when purchased, so they aren&apos;t posted again — they&apos;re included in the cost-per-egg total.</p>
      </Card>

      <Card>
        <CardHeader title={`Operating costs — ${period}`} action={<Button size="sm" onClick={save}>Save &amp; send to Finance</Button>} />
        <TableWrap>
          <thead><tr><Th>Cost</Th><Th>Posts to</Th><Th className="text-right">Amount (RWF)</Th></tr></thead>
          <tbody>
            {draftLines.map((l, i) => {
              const cat = PROD_COST_CATEGORIES.find((c) => c.key === l.category);
              return (
                <tr key={l.category}>
                  <Td className="font-medium">{cat?.label ?? l.category}</Td>
                  <Td className="text-xs text-muted">{cat?.account}</Td>
                  <Td className="w-40"><Input type="number" min={0} value={l.amount || ""} onChange={(e) => setLine(i, Number(e.target.value) || 0)} /></Td>
                </tr>
              );
            })}
            <tr className="border-t border-line font-semibold"><Td>Operating total</Td><Td></Td><Td className="text-right pr-3">{formatRWF(manualTotal)}</Td></tr>
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">Saving records the sheet; the Accountant&apos;s Accounting page posts these to the ledger (Dr each expense account / Cr Cash) — idempotently per period. You record; Finance posts.</p>
      </Card>

      <Card>
        <CardHeader title="Basis" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="Live birds" value={birds.toLocaleString()} />
          <StatTile label="Males" value={males.birds.toLocaleString()} />
          <StatTile label="Females" value={females.birds.toLocaleString()} />
          <StatTile label="Fertile eggs (period)" value={fertileEggs.toLocaleString()} />
          <StatTile label="Active flocks" value={String(flockCount)} />
        </div>
      </Card>
    </div>
  );
}
