"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { PRODUCTS, type Product } from "@/lib/types";
import { nowISO, todayISO, formatDate, formatDateTime } from "@/lib/format";
import type { ChickInventory } from "@/lib/hatchery/types";

const CAN_ADJUST = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager"];

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);

/** Freshness tone for day-old chicks, by age since hatch. */
function ageTone(days: number): "green" | "gold" | "neutral" {
  if (days <= 3) return "green";
  if (days <= 7) return "gold";
  return "neutral";
}

export default function ChickInventoryPage() {
  const { user } = useAuth();
  const { inventory, batches, upsertInventory } = useHatchery();
  const { toast } = useToast();

  const [product, setProduct] = useState<"all" | Product>("all");
  const [q, setQ] = useState("");
  const [includeDepleted, setIncludeDepleted] = useState(false);
  const [adjust, setAdjust] = useState<Record<string, string>>({});

  const today = todayISO();
  const canAdjust = !!user && CAN_ADJUST.includes(user.role);
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;
  const saleableOf = (id: string) => batches.find((b) => b.id === id)?.saleableCount ?? 0;

  const rows = useMemo(() => {
    return inventory
      .map((i) => {
        const saleable = saleableOf(i.batchId);
        return {
          inv: i,
          batchNo: batchNo(i.batchId),
          ageDays: daysBetween(i.hatchDate, today),
          allocated: Math.max(0, saleable - i.availableCount),
          saleable,
        };
      })
      .filter((r) => (includeDepleted ? true : r.inv.availableCount > 0))
      .filter((r) => product === "all" || r.inv.productType === product)
      .filter((r) => !q.trim() || r.batchNo.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => (a.inv.hatchDate < b.inv.hatchDate ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, batches, product, q, includeDepleted, today]);

  const totals = useMemo(() => {
    const live = inventory.filter((i) => i.availableCount > 0);
    const byProduct = (p: Product) => live.filter((i) => i.productType === p).reduce((s, i) => s + i.availableCount, 0);
    const total = live.reduce((s, i) => s + i.availableCount, 0);
    const oldest = live.reduce((m, i) => Math.max(m, daysBetween(i.hatchDate, today)), 0);
    return { total, lots: live.length, oldest, byProduct };
  }, [inventory, today]);

  if (!user) return null;

  function applyAdjust(inv: ChickInventory) {
    const delta = Number(adjust[inv.id]) || 0;
    if (delta === 0) return;
    const next = Math.max(0, inv.availableCount + delta);
    upsertInventory({ ...inv, availableCount: next, updatedBy: user!.email, on: nowISO() });
    toast(`${batchNo(inv.batchId)} available ${delta > 0 ? "+" : ""}${delta.toLocaleString()} → ${next.toLocaleString()}.`);
    setAdjust({ ...adjust, [inv.id]: "" });
  }

  return (
    <div className="space-y-5">

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Available chicks" value={totals.total.toLocaleString()} tone="gold" />
        <Kpi label="Ross 308" value={totals.byProduct("Ross 308").toLocaleString()} />
        <Kpi label="Tetra Super Harco" value={totals.byProduct("Tetra Super Harco").toLocaleString()} />
        <Kpi label="Lots in stock" value={totals.lots.toLocaleString()} />
        <Kpi label="Oldest lot" value={`${totals.oldest} d`} tone={totals.oldest > 7 ? "gold" : "green"} />
      </div>

      <Card>
        <CardHeader title="Available lots" />
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Product">
            <Select value={product} onChange={(e) => setProduct(e.target.value as "all" | Product)}
              options={[{ value: "all", label: "All products" }, ...PRODUCTS.map((p) => ({ value: p, label: p }))]} />
          </Field>
          <Field label="Search batch">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Batch code…" />
          </Field>
          <label className="flex items-center gap-2 pb-2.5 text-sm text-muted">
            <input type="checkbox" checked={includeDepleted} onChange={(e) => setIncludeDepleted(e.target.checked)} />
            Show depleted (0 left)
          </label>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th><Th>Product</Th><Th>Hatch date</Th><Th className="text-right">Age</Th>
              <Th className="text-right">Available</Th><Th className="text-right">Allocated</Th>
              {canAdjust && <Th>Adjust (+/−)</Th>}<Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={canAdjust ? 8 : 7} text="No chick inventory matches." />
            ) : (
              rows.map((r) => (
                <tr key={r.inv.id}>
                  <Td>
                    <Link href={`/hatchery/batches/${r.inv.batchId}`} className="font-medium text-gold-dark underline underline-offset-2">
                      {r.batchNo}
                    </Link>
                  </Td>
                  <Td>{r.inv.productType}</Td>
                  <Td>{formatDate(r.inv.hatchDate)}</Td>
                  <Td className="text-right"><Pill tone={ageTone(r.ageDays)}>{r.ageDays} d</Pill></Td>
                  <Td className="text-right font-semibold">{r.inv.availableCount.toLocaleString()}</Td>
                  <Td className="text-right text-muted">{r.allocated.toLocaleString()}</Td>
                  {canAdjust && (
                    <Td>
                      <div className="flex items-center gap-2">
                        <input type="number" value={adjust[r.inv.id] ?? ""} onChange={(e) => setAdjust({ ...adjust, [r.inv.id]: e.target.value })}
                          className="w-20 rounded-md border border-line bg-transparent px-2 py-1 text-sm" placeholder="±" />
                        <Button variant="secondary" size="sm" onClick={() => applyAdjust(r.inv)}>Apply</Button>
                      </div>
                    </Td>
                  )}
                  <Td className="text-xs text-muted">{formatDateTime(r.inv.on)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
        {canAdjust && (
          <p className="mt-2 text-xs text-muted">
            Adjust corrects on-hand chicks (e.g. mortality or a recount). Allocations to orders update this automatically — use adjust only for corrections.
          </p>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "gold" | "green" }) {
  const color = tone === "gold" ? "text-gold-dark" : tone === "green" ? "text-green" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paper p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
