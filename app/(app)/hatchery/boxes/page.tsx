"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { CHICKS_PER_BOX, type BoxLog, type Supply } from "@/lib/hatchery/types";
import { boxesNeeded, isoWeek, expectedHatchDate } from "@/lib/hatchery/lifecycle";

const CAN_MAKE = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Attendant", "Production Technician"];

export default function BoxesPage() {
  const { user } = useAuth();
  const { boxLogs, supplies, batches, upsertBoxLog, upsertSupply, newId } = useHatchery();
  const { recorder } = useOperator();
  const { toast } = useToast();

  const [made, setMade] = useState("");
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState<string | null>(null);

  const canMake = !!user && CAN_MAKE.includes(user.role);
  const boxStock = supplies.find((s) => s.kind === "box");
  const unassembled = boxStock?.quantity ?? 0;

  // Boxes needed this week = based on batches expected to hatch this ISO week and their saleable/eggs.
  const thisWeek = isoWeek(todayISO());
  const upcoming = useMemo(() => {
    return batches
      .filter((b) => b.steps["setting"] && !b.steps["counting"])
      .map((b) => {
        const setOn = b.steps["setting"]?.on?.slice(0, 10) ?? b.createdAt.slice(0, 10);
        const hatchDate = expectedHatchDate(setOn);
        // predicted saleable: use hatched/saleable if known else fertile estimate (eggs set).
        const predicted = b.saleableCount || b.hatchedCount || b.eggsSet;
        return { batch: b, hatchDate, week: isoWeek(hatchDate), boxes: boxesNeeded(predicted) };
      })
      .filter((x) => x.week === thisWeek);
  }, [batches, thisWeek]);

  const boxesNeededThisWeek = upcoming.reduce((s, x) => s + x.boxes, 0);
  const rows = useMemo(() => boxLogs.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [boxLogs]);

  if (!user) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const n = Number(made) || 0;
    if (n <= 0) return setErr("Enter how many boxes were assembled.");
    if (n > unassembled) return setErr(`Only ${unassembled} unassembled boxes in stock.`);
    const on = nowISO();
    const who = recorder(user!.name);
    const log: BoxLog = { id: newId("box"), date, boxesMade: n, by: who, on };
    upsertBoxLog(log);
    // Deplete unassembled stock.
    if (boxStock) {
      const s: Supply = {
        ...boxStock, quantity: boxStock.quantity - n,
        history: [...boxStock.history, `${on} — ${n} assembled by ${who} (−${n})`], on,
      };
      upsertSupply(s);
    }
    toast(`${n} box(es) assembled.`);
    setMade("");
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Box making</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Unassembled in stock" value={unassembled.toLocaleString()} tone={unassembled < boxesNeededThisWeek ? "warn" : "ok"} />
        <Stat label={`Boxes needed (week ${thisWeek})`} value={boxesNeededThisWeek.toLocaleString()} />
        <Stat label="Chicks per box" value={String(CHICKS_PER_BOX)} />
      </div>

      <Card>
        <CardHeader title={`Batches hatching this week (week ${thisWeek})`} />
        <TableWrap>
          <thead><tr><Th>Batch</Th><Th>Product</Th><Th>Expected hatch</Th><Th className="text-right">Predicted chicks</Th><Th className="text-right">Boxes</Th></tr></thead>
          <tbody>
            {upcoming.length === 0 ? <EmptyRow colSpan={5} text="No batches hatching this week." /> : upcoming.map((x) => (
              <tr key={x.batch.id}>
                <Td className="font-medium">{x.batch.batchNo}</Td>
                <Td>{x.batch.productType}</Td>
                <Td>{formatDate(x.hatchDate)}</Td>
                <Td className="text-right">{(x.batch.saleableCount || x.batch.hatchedCount || x.batch.eggsSet).toLocaleString()}</Td>
                <Td className="text-right font-medium">{x.boxes}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {canMake && (
        <Card>
          <CardHeader title="Log boxes assembled today" />
          {!boxStock ? (
            <p className="text-sm text-status-refunded">Out of unassembled boxes — none in stock. Ask the hatchery manager to add box stock before assembling.</p>
          ) : (
            <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Boxes assembled"><Input type="number" min={0} value={made} onChange={(e) => setMade(e.target.value)} /></Field>
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <div className="flex items-end"><Button type="submit">Save</Button></div>
              {err && <p className="sm:col-span-3 text-sm text-status-refunded">{err}</p>}
            </form>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Box-making log" />
        <TableWrap>
          <thead><tr><Th>Date</Th><Th className="text-right">Boxes made</Th><Th>By</Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={3} text="No boxes logged yet." /> : rows.map((l) => (
              <tr key={l.id}><Td>{formatDate(l.date)}</Td><Td className="text-right font-medium">{l.boxesMade}</Td><Td>{l.by}</Td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
        {tone === "warn" && <Pill tone="gold">low</Pill>}
      </div>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
    </Card>
  );
}
