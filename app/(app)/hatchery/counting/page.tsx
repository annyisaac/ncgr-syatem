"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import type { Batch, ChickCount, ChickInventory } from "@/lib/hatchery/types";
import { markStep, boxesNeeded } from "@/lib/hatchery/lifecycle";

const CAN_COUNT = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Attendant", "Production Technician"];

export default function CountingPage() {
  const { user } = useAuth();
  const { batches, counts, upsertBatch, upsertCount, upsertInventory, newId } = useHatchery();
  const { recorder } = useOperator();
  const { toast } = useToast();

  const [batchId, setBatchId] = useState("");
  const [boxes, setBoxes] = useState<number[]>([]);
  const [current, setCurrent] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canCount = !!user && CAN_COUNT.includes(user.role);

  // Batches that are hatched but not yet counted.
  const countable = useMemo(() => batches.filter((b) => b.steps["hatching"] && !b.steps["counting"]), [batches]);
  const batch = countable.find((b) => b.id === batchId) ?? null;

  const total = boxes.reduce((s, n) => s + n, 0);
  const rows = useMemo(() => counts.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [counts]);
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;

  if (!user) return null;

  function addBox() {
    const n = Number(current) || 0;
    if (n <= 0) return;
    setBoxes([...boxes, n]);
    setCurrent("");
  }

  function finish() {
    setErr(null);
    if (!batch) return setErr("Select a batch.");
    if (boxes.length === 0) return setErr("Count at least one box.");
    const on = nowISO();
    const by = recorder(user!.email);
    const count: ChickCount = { id: newId("count"), batchId: batch.id, boxes, total, by, on };
    upsertCount(count);
    upsertBatch(markStep({ ...batch, countedTotal: total }, "counting", user!));
    const inv: ChickInventory = {
      id: newId("inv"), productType: batch.productType,
      hatchDate: batch.steps["hatching"]?.on?.slice(0, 10) ?? todayISO(),
      availableCount: total, batchId: batch.id, updatedBy: by, on,
    };
    upsertInventory(inv);
    toast(`Counted ${total.toLocaleString()} chicks in ${boxes.length} box(es).`);
    setBatchId(""); setBoxes([]); setCurrent("");
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Counting &amp; boxing</h1>

      {canCount && (
        <Card>
          <CardHeader title="Count a batch box by box" />
          {countable.length === 0 ? (
            <p className="text-sm text-muted">No hatched batches waiting to be counted.</p>
          ) : (
            <div className="space-y-4">
              <Field label="Hatched batch">
                <Select value={batchId} onChange={(e) => { setBatchId(e.target.value); setBoxes([]); setCurrent(""); setErr(null); }}
                  placeholder="Select batch"
                  options={countable.map((b) => ({ value: b.id, label: `${b.batchNo} · ${b.saleableCount.toLocaleString()} saleable` }))} />
              </Field>

              {batch && (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label={`Box ${boxes.length + 1} — chicks counted`}>
                      <Input type="number" min={0} value={current}
                        onChange={(e) => setCurrent(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBox(); } }} />
                    </Field>
                    <Button onClick={addBox} variant="secondary">Add box</Button>
                  </div>

                  {boxes.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {boxes.map((n, i) => (
                        <span key={i} className="inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-1 text-sm">
                          <span className="text-muted">#{i + 1}</span> {n}
                          <button onClick={() => setBoxes(boxes.filter((_, j) => j !== i))} className="text-muted hover:text-red">×</button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <Stat label="Boxes counted" value={String(boxes.length)} />
                    <Stat label="Total chicks" value={total.toLocaleString()} strong />
                    <Stat label="Saleable (hatch)" value={batch.saleableCount.toLocaleString()} />
                  </div>
                  {total !== batch.saleableCount && boxes.length > 0 && (
                    <p className="text-xs text-muted">Counted total differs from hatch saleable ({batch.saleableCount.toLocaleString()}) by {Math.abs(total - batch.saleableCount).toLocaleString()}.</p>
                  )}
                  {err && <p className="text-sm text-status-refunded">{err}</p>}
                  <div className="flex justify-end"><Button onClick={finish}>Finish counting</Button></div>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Recent counts" />
        <TableWrap>
          <thead><tr><Th>When</Th><Th>Batch</Th><Th className="text-right">Boxes</Th><Th className="text-right">Chicks</Th><Th className="text-right">Boxes needed</Th><Th>By</Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={6} text="No counts yet." /> : rows.map((c) => (
              <tr key={c.id}>
                <Td>{formatDate(c.on)}</Td><Td>{batchNo(c.batchId)}</Td>
                <Td className="text-right">{c.boxes.length}</Td>
                <Td className="text-right font-medium">{c.total.toLocaleString()}</Td>
                <Td className="text-right">{boxesNeeded(c.total)}</Td>
                <Td>{c.by}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={strong ? "text-lg font-bold text-ink" : "font-medium text-ink"}>{value}</p>
    </div>
  );
}
