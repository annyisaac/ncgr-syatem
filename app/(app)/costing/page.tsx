"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { nowISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listJournals, upsertJournals } from "@/lib/accounting";
import {
  COST_CATEGORIES, avgCostPerChick, batchProfitability, costingEntriesToSync, labelForCategory,
  listBatchCosts, totalCost, unitCosts, upsertBatchCost, type BatchCost, type CostLine,
} from "@/lib/costing";
import type { Batch } from "@/lib/hatchery/types";
import type { Product } from "@/lib/types";

export default function CostingPage() {
  const { user } = useAuth();
  const { orders } = useData();
  const { batches } = useHatchery();
  const { toast } = useToast();
  const [costs, setCosts] = useState<BatchCost[]>([]);
  const [editing, setEditing] = useState<BatchCost | null>(null);

  const canUse = user?.role === "Admin" || user?.role === "Accountant";

  const load = useCallback(async () => { try { setCosts(await listBatchCosts()); } catch { /* keep */ } }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("costing-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "batch_costs") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  // Auto-post capitalisation + COGS to the ledger.
  useEffect(() => {
    if (!canUse || costs.length === 0) return;
    (async () => {
      try {
        const j = await listJournals();
        const diff = costingEntriesToSync(costs, batches, orders, j);
        if (diff.length) await upsertJournals(diff);
      } catch { /* retry on next change */ }
    })();
  }, [costs, batches, orders, canUse]);

  const hatched = useMemo(() => batches.filter((b) => b.steps?.["hatching"]), [batches]);
  const costById = useMemo(() => new Map(costs.map((c) => [c.batchId, c])), [costs]);
  const avgRoss = avgCostPerChick("Ross 308", costs, batches);
  const avgTetra = avgCostPerChick("Tetra Super Harco", costs, batches);
  const profit = useMemo(() => batchProfitability(costs, batches, orders), [costs, batches, orders]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;

  function openEditor(b: Batch) {
    const existing = costById.get(b.id);
    setEditing(existing ?? {
      id: b.id, batchId: b.id, batchNo: b.batchNo, product: b.productType as Product,
      lines: [{ category: "eggs", amount: 0 }], status: "draft", by: user!.email, on: nowISO(),
    });
  }
  async function save(status: "draft" | "posted") {
    if (!editing) return;
    const clean: BatchCost = { ...editing, status, on: nowISO(), lines: editing.lines.filter((l) => (Number(l.amount) || 0) > 0) };
    if (status === "posted" && clean.lines.length === 0) return toast("Add at least one cost line.", "info");
    setCosts((p) => { const i = p.findIndex((x) => x.id === clean.id); const c = p.slice(); if (i === -1) c.unshift(clean); else c[i] = clean; return c; });
    try { await upsertBatchCost(clean); toast(status === "posted" ? "Batch cost posted — capitalised to inventory." : "Draft saved."); } catch { toast("Could not save.", "error"); void load(); }
    setEditing(null);
  }
  const setLine = (i: number, patch: Partial<CostLine>) => setEditing((e) => e ? { ...e, lines: e.lines.map((l, x) => (x === i ? { ...l, ...patch } : l)) } : e);

  const editBatch = editing ? batches.find((b) => b.id === editing.batchId) : undefined;
  const eu = editing ? unitCosts(editing, editBatch) : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Batches costed" value={String(costs.filter((c) => c.status === "posted").length)} />
        <StatTile label="Avg cost / Ross chick" value={avgRoss ? formatRWF(avgRoss) : "—"} />
        <StatTile label="Avg cost / Tetra chick" value={avgTetra ? formatRWF(avgTetra) : "—"} />
        <StatTile label="Total capitalised" value={formatRWF(costs.filter((c) => c.status === "posted").reduce((s, c) => s + totalCost(c), 0))} tone="green" />
      </div>

      {editing && (
        <Card>
          <CardHeader title={`Batch costs — ${editing.batchNo}`} />
          <p className="-mt-1 mb-3 text-xs text-muted">
            Enter what this batch consumed. Posting capitalises the total into finished-goods inventory
            (Dr Inventory — Chicks / Cr the source accounts), so costs aren&apos;t counted twice.
          </p>
          <TableWrap>
            <thead><tr><Th>Cost</Th><Th>Note</Th><Th className="text-right">Amount</Th><Th></Th></tr></thead>
            <tbody>
              {editing.lines.map((l, i) => (
                <tr key={i}>
                  <Td className="w-56"><Select value={l.category} onChange={(e) => setLine(i, { category: e.target.value })} options={COST_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))} /></Td>
                  <Td><Input value={l.note ?? ""} onChange={(e) => setLine(i, { note: e.target.value })} placeholder="optional" /></Td>
                  <Td><Input type="number" min={0} value={l.amount || ""} onChange={(e) => setLine(i, { amount: Number(e.target.value) || 0 })} /></Td>
                  <Td>{editing.lines.length > 1 && <Button size="sm" variant="ghost" onClick={() => setEditing((e) => e ? { ...e, lines: e.lines.filter((_, x) => x !== i) } : e)}>✕</Button>}</Td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold"><Td>Total batch cost</Td><Td></Td><Td className="text-right">{formatRWF(eu?.total ?? 0)}</Td><Td></Td></tr>
            </tbody>
          </TableWrap>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Eggs set" value={(editBatch?.eggsSet ?? 0).toLocaleString()} />
            <StatTile label="Cost / egg set" value={formatRWF(eu?.perEggSet ?? 0)} />
            <StatTile label="Cost / hatched chick" value={formatRWF(eu?.perHatched ?? 0)} />
            <StatTile label="Cost / saleable chick" value={formatRWF(eu?.perSaleable ?? 0)} tone="gold" />
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing((e) => e ? { ...e, lines: [...e.lines, { category: "other", amount: 0 }] } : e)}>＋ Add cost line</Button>
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="secondary" onClick={() => save("draft")}>Save draft</Button>
            <Button onClick={() => save("posted")}>Post to inventory</Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`Hatched batches (${hatched.length})`} />
        <TableWrap>
          <thead><tr>
            <Th>Batch</Th><Th>Product</Th><Th className="text-right">Eggs set</Th><Th className="text-right">Hatched</Th><Th className="text-right">Saleable</Th>
            <Th className="text-right">Total cost</Th><Th className="text-right">Cost/chick</Th><Th>Status</Th><Th></Th>
          </tr></thead>
          <tbody>
            {hatched.length === 0 ? <EmptyRow colSpan={9} text="No hatched batches yet." /> : hatched.map((b) => {
              const c = costById.get(b.id);
              const u = c ? unitCosts(c, b) : null;
              return (
                <tr key={b.id}>
                  <Td className="font-medium">{b.batchNo}</Td>
                  <Td>{b.productType}</Td>
                  <Td className="text-right">{b.eggsSet.toLocaleString()}</Td>
                  <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
                  <Td className="text-right">{b.saleableCount.toLocaleString()}</Td>
                  <Td className="text-right">{u ? formatRWF(u.total) : "—"}</Td>
                  <Td className="text-right font-medium">{u ? formatRWF(u.perSaleable) : "—"}</Td>
                  <Td>{c ? (c.status === "posted" ? <Pill tone="green">Costed</Pill> : <Pill tone="gold">Draft</Pill>) : <Pill tone="neutral">Not costed</Pill>}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => openEditor(b)}>{c ? "Edit" : "Add costs"}</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title="Batch profitability" />
        <p className="-mt-1 mb-2 text-xs text-muted">Saleable chicks valued at the average delivered price for that product, less the batch cost.</p>
        <TableWrap>
          <thead><tr><Th>Batch</Th><Th>Product</Th><Th className="text-right">Saleable</Th><Th className="text-right">Cost</Th><Th className="text-right">Cost/chick</Th><Th className="text-right">Revenue</Th><Th className="text-right">Margin</Th></tr></thead>
          <tbody>
            {profit.length === 0 ? <EmptyRow colSpan={7} text="Post a batch cost to see profitability." /> : profit.map((p) => (
              <tr key={p.batchId}>
                <Td className="font-medium">{p.batchNo}</Td><Td>{p.product}</Td>
                <Td className="text-right">{p.saleable.toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(p.cost)}</Td>
                <Td className="text-right">{formatRWF(p.perChick)}</Td>
                <Td className="text-right">{formatRWF(p.revenue)}</Td>
                <Td className={`text-right font-semibold ${p.margin >= 0 ? "text-green" : "text-red"}`}>{formatRWF(p.margin)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <p className="text-xs text-muted">
        Posting a batch cost capitalises it into Inventory — Chicks. When an order is delivered, the chicks are relieved at the
        weighted-average cost per saleable chick: Dr Cost of Goods Sold / Cr Inventory — Chicks. Mortality, culls and hatch
        losses are absorbed automatically — the same cost spreads over fewer saleable chicks.
        {costs.length > 0 && ` Categories map to: ${COST_CATEGORIES.slice(0, 3).map((c) => labelForCategory(c.key)).join(", ")}…`}
      </p>
    </div>
  );
}
