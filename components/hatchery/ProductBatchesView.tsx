"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { StatTile } from "@/components/dashboard/DashKit";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { fetchTable } from "@/lib/hatchery/db";
import { getSupabase } from "@/lib/supabase";
import { LIFECYCLE_STEPS, type Batch, type ChickInventory } from "@/lib/hatchery/types";
import { stepLabel } from "@/lib/hatchery/lifecycle";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Product } from "@/lib/types";

/**
 * Cache shared across every ProductBatchesView (Ross + Tetra) and across page
 * visits, so the DB round trip only blocks the very first open. Later visits
 * render instantly from cache while a fresh copy loads in the background.
 */
let cache: { batches: Batch[]; inventory: ChickInventory[] } | null = null;

async function loadHatcheryView() {
  const [batches, inventory] = await Promise.all([
    fetchTable<Batch>("batches"),
    fetchTable<ChickInventory>("chick_inventory"),
  ]);
  cache = { batches, inventory };
  return cache;
}

/**
 * Read-only "live view of production from the hatchery" for one product. The
 * Ross Order Receiver (Ross 308) and the Tetra zone managers (Tetra Super
 * Harco) each get their own product's batches, powered by this one component.
 */
export function ProductBatchesView({ product }: { product: Product }) {
  const [batches, setBatches] = useState<Batch[]>(cache?.batches ?? []);
  const [inventory, setInventory] = useState<ChickInventory[]>(cache?.inventory ?? []);
  const [loading, setLoading] = useState(!cache);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await loadHatcheryView();
        if (!active) return;
        setBatches(data.batches);
        setInventory(data.inventory);
      } catch {
        /* RLS or network — keep whatever we have */
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();

    // Live: reflect hatchery production the moment it changes (debounced).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 350);
    };
    const sb = getSupabase();
    const channel = sb
      .channel("product-batches-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: { table?: string }) => {
        if (payload.table === "batches" || payload.table === "chick_inventory") bump();
      })
      .subscribe();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, []);

  const mine = useMemo(
    () => batches.filter((b) => b.productType === product).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [batches, product]
  );
  const availByBatch = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inventory) if (i.productType === product) m.set(i.batchId, (m.get(i.batchId) ?? 0) + i.availableCount);
    return m;
  }, [inventory, product]);

  const totalEggs = mine.reduce((s, b) => s + b.eggsSet, 0);
  const totalHatched = mine.reduce((s, b) => s + b.hatchedCount, 0);
  const totalAvail = useMemo(() => inventory.filter((i) => i.productType === product).reduce((s, i) => s + i.availableCount, 0), [inventory, product]);
  const activeCount = mine.filter((b) => b.status === "active").length;

  const batch = mine.find((b) => b.id === selected) ?? null;
  const progress = (b: Batch) => LIFECYCLE_STEPS.filter((s) => b.steps?.[s.key]).length;
  const tone = (s: Batch["status"]) => (s === "delivered" ? "fulfilled" : s === "dispatched" ? "gold" : s === "inactive" ? "neutral" : "info");

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Live view of {product} production from the hatchery — eggs set, what stage each batch is at, and chicks still available to sell.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Active batches" value={String(activeCount)} />
        <StatTile label="Eggs set" value={totalEggs.toLocaleString()} />
        <StatTile label="Chicks hatched" value={totalHatched.toLocaleString()} tone="green" />
        <StatTile label="Chicks available" value={totalAvail.toLocaleString()} tone="green" />
      </div>

      <Card>
        <CardHeader title={`Batches (${mine.length})`} />
        <TableWrap>
            <thead>
              <tr>
                <Th>Batch</Th><Th>Set date</Th><Th>Stage</Th>
                <Th className="text-right">Eggs set</Th><Th className="text-right">Hatched</Th>
                <Th className="text-right">Saleable</Th><Th className="text-right">Available</Th><Th>Status</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {mine.length === 0 ? (
                <EmptyRow colSpan={9} text={loading ? "" : `No ${product} batches yet.`} />
              ) : mine.map((b) => (
                <tr key={b.id}>
                  <Td className="font-medium">{b.batchNo}</Td>
                  <Td>{b.createdAt ? formatDate(b.createdAt.slice(0, 10)) : "—"}</Td>
                  <Td>{stepLabel(b.currentStep)} <span className="text-xs text-muted">({progress(b)}/{LIFECYCLE_STEPS.length})</span></Td>
                  <Td className="text-right">{b.eggsSet.toLocaleString()}</Td>
                  <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
                  <Td className="text-right">{b.saleableCount.toLocaleString()}</Td>
                  <Td className="text-right font-semibold text-green">{(availByBatch.get(b.id) ?? 0).toLocaleString()}</Td>
                  <Td><Pill tone={tone(b.status)}>{b.status}</Pill></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setSelected(b.id === selected ? null : b.id)}>{b.id === selected ? "Hide" : "Details"}</Button></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
      </Card>

      {batch && (
        <Card>
          <CardHeader title={`${batch.batchNo} — everything on this batch`} />
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Info label="Eggs set" value={batch.eggsSet.toLocaleString()} />
            <Info label="Hatched" value={batch.hatchedCount.toLocaleString()} />
            <Info label="Saleable" value={batch.saleableCount.toLocaleString()} />
            <Info label="Available now" value={(availByBatch.get(batch.id) ?? 0).toLocaleString()} />
          </div>

          {batch.flocks && batch.flocks.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Flocks in this batch</p>
              <div className="space-y-1 text-sm">
                {batch.flocks.map((f) => (
                  <div key={f.flockId + f.farm} className="flex flex-wrap justify-between gap-2 rounded-md border border-line px-3 py-1.5">
                    <span>{f.farm ? `${f.farm} · ` : ""}flock {f.flockId}</span>
                    <span className="text-muted">set {f.eggsSet.toLocaleString()} eggs</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <p className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Progress</p>
            <ol className="space-y-1.5">
              {LIFECYCLE_STEPS.map((s) => {
                const mark = batch.steps?.[s.key];
                const isNext = !mark && LIFECYCLE_STEPS.find((x) => !batch.steps?.[x.key])?.key === s.key;
                return (
                  <li key={s.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${mark ? "border-green/30 bg-green-bg" : isNext ? "border-gold bg-gold-bg" : "border-line"}`}>
                    <span className="font-medium">{mark ? "✓ " : isNext ? "→ " : ""}{s.label}</span>
                    {mark && <span className="text-xs text-muted">{formatDateTime(mark.on)}</span>}
                  </li>
                );
              })}
            </ol>
          </div>
        </Card>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}
