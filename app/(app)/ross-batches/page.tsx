"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Kpi } from "@/components/dashboard/Kpi";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { fetchTable } from "@/lib/hatchery/db";
import { LIFECYCLE_STEPS, type Batch, type ChickInventory } from "@/lib/hatchery/types";
import { stepLabel } from "@/lib/hatchery/lifecycle";
import { formatDate, formatDateTime } from "@/lib/format";

const PRODUCT = "Ross 308";

export default function RossBatchesPage() {
  const { user } = useAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [inventory, setInventory] = useState<ChickInventory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [b, inv] = await Promise.all([
          fetchTable<Batch>("batches"),
          fetchTable<ChickInventory>("chick_inventory"),
        ]);
        if (!active) return;
        setBatches(b);
        setInventory(inv);
      } catch {
        /* RLS or network — leave empty */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const rossBatches = useMemo(
    () => batches.filter((b) => b.productType === PRODUCT).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [batches]
  );
  const availByBatch = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inventory) if (i.productType === PRODUCT) m.set(i.batchId, (m.get(i.batchId) ?? 0) + i.availableCount);
    return m;
  }, [inventory]);

  const totalEggs = rossBatches.reduce((s, b) => s + b.eggsSet, 0);
  const totalHatched = rossBatches.reduce((s, b) => s + b.hatchedCount, 0);
  const totalAvail = useMemo(() => inventory.filter((i) => i.productType === PRODUCT).reduce((s, i) => s + i.availableCount, 0), [inventory]);
  const activeCount = rossBatches.filter((b) => b.status === "active").length;

  const batch = rossBatches.find((b) => b.id === selected) ?? null;
  const progress = (b: Batch) => LIFECYCLE_STEPS.filter((s) => b.steps?.[s.key]).length;
  const tone = (s: Batch["status"]) => (s === "delivered" ? "fulfilled" : s === "dispatched" ? "gold" : s === "inactive" ? "neutral" : "info");

  if (!user) return null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted">Live view of Ross production from the hatchery — eggs set, what stage each batch is at, and chicks still available to sell.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Active batches" value={String(activeCount)} icon="orders" />
        <Kpi label="Eggs set" value={totalEggs.toLocaleString()} icon="chart" />
        <Kpi label="Chicks hatched" value={totalHatched.toLocaleString()} tone="green" icon="chicks" />
        <Kpi label="Chicks available" value={totalAvail.toLocaleString()} tone="green" icon="check" />
      </div>

      <Card>
        <CardHeader title={`Batches (${rossBatches.length})`} />
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Batch</Th><Th>Set date</Th><Th>Stage</Th>
                <Th className="text-right">Eggs set</Th><Th className="text-right">Hatched</Th>
                <Th className="text-right">Saleable</Th><Th className="text-right">Available</Th><Th>Status</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {rossBatches.length === 0 ? (
                <EmptyRow colSpan={9} text="No Ross batches yet." />
              ) : rossBatches.map((b) => (
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
        )}
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
