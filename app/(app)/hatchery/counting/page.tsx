"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, formatDate } from "@/lib/format";
import type { Batch, BatchFlock, ChickCount } from "@/lib/hatchery/types";
import { boxesNeeded, batchFlocks, flockTransferred } from "@/lib/hatchery/lifecycle";

const CAN_COUNT = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Attendant", "Production Technician"];

interface FlockRow { batch: Batch; flock: BatchFlock; }

export default function CountingPage() {
  const { user } = useAuth();
  const { batches, counts, upsertCount, newId } = useHatchery();
  const { recorder } = useOperator();
  const { toast } = useToast();

  const [sel, setSel] = useState("");
  const [boxes, setBoxes] = useState<number[]>([]);
  const [current, setCurrent] = useState("");
  const [culls, setCulls] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canCount = !!user && CAN_COUNT.includes(user.role);

  // A flock is countable once it's in a hatcher (transferred) and not yet counted.
  const counted = useMemo(() => new Set(counts.map((c) => `${c.batchId}::${c.flockId ?? ""}`)), [counts]);
  const countable = useMemo(() => {
    const out: FlockRow[] = [];
    for (const b of batches) {
      if (b.status !== "active") continue;
      for (const f of batchFlocks(b)) {
        if (flockTransferred(f) > 0 && !counted.has(`${b.id}::${f.flockId}`)) out.push({ batch: b, flock: f });
      }
    }
    return out;
  }, [batches, counted]);

  const key = (r: FlockRow) => `${r.batch.id}::${r.flock.flockId}`;
  const row = countable.find((r) => key(r) === sel) ?? null;
  const saleable = boxes.reduce((s, n) => s + n, 0);
  const cullsN = Number(culls) || 0;
  const inHatcher = row ? flockTransferred(row.flock) : 0;

  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;
  const rows = useMemo(() => counts.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [counts]);

  if (!user) return null;

  function addBox() {
    const n = Number(current) || 0;
    if (n <= 0) return;
    setBoxes([...boxes, n]);
    setCurrent("");
  }

  function finish() {
    setErr(null);
    if (!row) return setErr("Select a flock to count.");
    if (boxes.length === 0) return setErr("Count at least one box of saleable chicks.");
    const count: ChickCount = {
      id: newId("count"),
      batchId: row.batch.id,
      flockId: row.flock.flockId,
      boxes,
      total: saleable,
      culls: cullsN,
      by: recorder(user!.email),
      on: nowISO(),
      verified: false,
    };
    upsertCount(count);
    toast(`Counted ${saleable.toLocaleString()} saleable + ${cullsN.toLocaleString()} culls — awaiting verification.`);
    setSel(""); setBoxes([]); setCurrent(""); setCulls("");
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Counting &amp; boxing</h1>
      <p className="-mt-2 text-sm text-muted">Count each flock&apos;s hatched chicks box by box (saleable), then the culls. A Production Technician verifies on the Hatch page.</p>

      {canCount && (
        <Card>
          <CardHeader title="Count a flock box by box" />
          {countable.length === 0 ? (
            <p className="text-sm text-muted">No flocks waiting to be counted. Transfer flocks to a hatcher first.</p>
          ) : (
            <div className="space-y-4">
              <Field label="Flock (batch · farm · flock)">
                <Select value={sel} onChange={(e) => { setSel(e.target.value); setBoxes([]); setCurrent(""); setCulls(""); setErr(null); }}
                  placeholder="Select flock"
                  options={countable.map((r) => ({ value: key(r), label: `${r.batch.batchNo} · ${r.flock.farm} · flock ${r.flock.flockId} · ${flockTransferred(r.flock).toLocaleString()} in hatcher` }))} />
              </Field>

              {row && (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label={`Box ${boxes.length + 1} — saleable chicks`}>
                      <Input type="number" min={0} value={current}
                        onChange={(e) => setCurrent(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBox(); } }} />
                    </Field>
                    <Button onClick={addBox} variant="secondary">Add box</Button>
                    <Field label="Culls (total)">
                      <Input type="number" min={0} value={culls} onChange={(e) => setCulls(e.target.value)} />
                    </Field>
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

                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <Stat label="Boxes" value={String(boxes.length)} />
                    <Stat label="Saleable counted" value={saleable.toLocaleString()} strong />
                    <Stat label="Culls" value={cullsN.toLocaleString()} />
                    <Stat label="Hatched (saleable + culls)" value={(saleable + cullsN).toLocaleString()} />
                  </div>
                  <p className="text-xs text-muted">In hatcher for this flock: {inHatcher.toLocaleString()}. Hatched can be lower (unhatched eggs).</p>
                  {err && <p className="text-sm text-status-refunded">{err}</p>}
                  <div className="flex justify-end"><Button onClick={finish}>Submit count for verification</Button></div>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Recent counts" />
        <TableWrap>
          <thead>
            <tr><Th>When</Th><Th>Batch</Th><Th>Flock</Th><Th className="text-right">Boxes</Th><Th className="text-right">Saleable</Th><Th className="text-right">Culls</Th><Th className="text-right">Boxes needed</Th><Th>Status</Th><Th>By</Th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={9} text="No counts yet." /> : rows.map((c) => (
              <tr key={c.id}>
                <Td>{formatDate(c.on)}</Td>
                <Td>{batchNo(c.batchId)}</Td>
                <Td>{c.flockId ?? "—"}</Td>
                <Td className="text-right">{c.boxes.length}</Td>
                <Td className="text-right font-medium">{c.total.toLocaleString()}</Td>
                <Td className="text-right">{(c.culls ?? 0).toLocaleString()}</Td>
                <Td className="text-right">{boxesNeeded(c.total)}</Td>
                <Td>{c.verified ? <Pill tone="green">Verified</Pill> : <Pill tone="gold">Awaiting verification</Pill>}</Td>
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
