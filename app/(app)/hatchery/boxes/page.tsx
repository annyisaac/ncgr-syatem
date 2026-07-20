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
import { CHICKS_PER_BOX, type BoxLog, type BoxTarget, type Supply } from "@/lib/hatchery/types";
import { isoWeek, isoWeekYear } from "@/lib/hatchery/lifecycle";

const CAN_MAKE = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Attendant", "Production Technician"];
// Who sets the weekly target — the hatchery manager and production technician.
const CAN_TARGET = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

/** Week label/key for a date, e.g. "H26-W28". */
function weekKey(dateIso: string): string {
  const yy = String(isoWeekYear(dateIso)).slice(-2);
  const ww = String(isoWeek(dateIso)).padStart(2, "0");
  return `H${yy}-W${ww}`;
}

export default function BoxesPage() {
  const { user } = useAuth();
  const { boxLogs, boxTargets, supplies, upsertBoxLog, upsertBoxTarget, upsertSupply, newId } = useHatchery();
  const { recorder } = useOperator();
  const { toast } = useToast();

  const [made, setMade] = useState("");
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState<string | null>(null);

  // Weekly target entry
  const [targetWeekDate, setTargetWeekDate] = useState(todayISO());
  const [targetBoxes, setTargetBoxes] = useState("");
  const [targetErr, setTargetErr] = useState<string | null>(null);

  const canMake = !!user && CAN_MAKE.includes(user.role);
  const canTarget = !!user && CAN_TARGET.includes(user.role);
  const boxStock = supplies.find((s) => s.kind === "box");
  const unassembled = boxStock?.quantity ?? 0;

  const thisWeek = weekKey(todayISO());
  const thisWeekTarget = boxTargets.find((t) => t.week === thisWeek);
  const boxesNeededThisWeek = thisWeekTarget?.boxes ?? 0;

  const editingWeek = weekKey(targetWeekDate);
  const editingExisting = boxTargets.find((t) => t.week === editingWeek);

  const rows = useMemo(() => boxLogs.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [boxLogs]);
  const targetRows = useMemo(
    () => boxTargets.slice().sort((a, b) => (a.week < b.week ? 1 : -1)),
    [boxTargets]
  );

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

  function saveTarget(e: React.FormEvent) {
    e.preventDefault();
    setTargetErr(null);
    const n = Number(targetBoxes) || 0;
    if (n <= 0) return setTargetErr("Enter the number of boxes needed for the week.");
    const on = nowISO();
    const rec: BoxTarget = { id: `boxtarget_${editingWeek}`, week: editingWeek, boxes: n, by: user!.name, on };
    upsertBoxTarget(rec);
    toast(`Boxes needed for ${editingWeek} set to ${n}.`);
    setTargetBoxes("");
  }

  return (
    <div className="space-y-5">

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Unassembled in stock" value={unassembled.toLocaleString()} tone={boxesNeededThisWeek > 0 && unassembled < boxesNeededThisWeek ? "warn" : "ok"} />
        <Stat label={`Boxes needed (${thisWeek})`} value={boxesNeededThisWeek ? boxesNeededThisWeek.toLocaleString() : "—"} />
        <Stat label="Chicks per box" value={String(CHICKS_PER_BOX)} />
      </div>

      {canTarget && (
        <Card>
          <CardHeader title="Boxes needed this week" />
          <p className="-mt-1 mb-3 text-xs text-muted">Enter how many boxes are needed for the week. Re-entering a week overwrites its number.</p>
          <form onSubmit={saveTarget} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Week (any date in it)"><Input type="date" value={targetWeekDate} onChange={(e) => setTargetWeekDate(e.target.value)} /></Field>
            <Field label={`Boxes needed (${editingWeek})`}>
              <Input type="number" min={0} value={targetBoxes} onChange={(e) => setTargetBoxes(e.target.value)}
                placeholder={editingExisting ? `currently ${editingExisting.boxes}` : "—"} />
            </Field>
            <div className="flex items-end"><Button type="submit">Save</Button></div>
            {targetErr && <p className="sm:col-span-3 text-sm text-status-refunded">{targetErr}</p>}
          </form>
        </Card>
      )}

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
        <CardHeader title="Boxes needed by week" />
        <TableWrap>
          <thead><tr><Th>Week</Th><Th className="text-right">Boxes needed</Th><Th>Set by</Th><Th>On</Th></tr></thead>
          <tbody>
            {targetRows.length === 0 ? <EmptyRow colSpan={4} text="No weekly targets set yet." /> : targetRows.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.week}{t.week === thisWeek && <Pill tone="gold" className="ml-2">this week</Pill>}</Td>
                <Td className="text-right font-medium">{t.boxes.toLocaleString()}</Td>
                <Td>{t.by}</Td>
                <Td>{formatDate(t.on)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

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
