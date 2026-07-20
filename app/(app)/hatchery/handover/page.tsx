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
import { nowISO, todayISO, formatDate, formatDateTime } from "@/lib/format";
import type { ShiftHandover, ShiftName } from "@/lib/hatchery/types";

const blank = () => ({ date: todayISO(), shift: "day" as ShiftName, summary: "", pending: "", machinesNote: "" });

export default function HandoverPage() {
  const { user } = useAuth();
  const { shiftHandovers, upsertShiftHandover, newId } = useHatchery();
  const { operator: sessionOp } = useOperator();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [f, setF] = useState(blank());
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(() => shiftHandovers.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [shiftHandovers]);
  if (!user) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.summary.trim()) return setErr("Add a short summary of the shift.");
    const h: ShiftHandover = {
      id: newId("shift"),
      date: f.date,
      shift: f.shift,
      summary: f.summary.trim(),
      pending: f.pending.trim(),
      machinesNote: f.machinesNote.trim() || undefined,
      by: user!.email,
      byName: sessionOp?.name ?? user!.name,
      on: nowISO(),
    };
    void upsertShiftHandover(h);
    toast("Shift handover recorded.");
    setShow(false);
    setF(blank());
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">End-of-shift notes so the next shift knows the state of the floor.</p>
        <Button onClick={() => setShow((v) => !v)}>{show ? "Hide form" : "Record handover"}</Button>
      </div>

      {show && (
        <Card>
          <CardHeader title="Record shift handover" />
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Shift"><Select value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value as ShiftName })} options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]} /></Field>
            <div className="sm:col-span-2"><Field label="Shift summary — what happened"><Input value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="Sets done, hatches, incidents…" /></Field></div>
            <div className="sm:col-span-2"><Field label="Pending for the next shift"><Input value={f.pending} onChange={(e) => setF({ ...f, pending: e.target.value })} placeholder="Tasks / follow-ups to hand over" /></Field></div>
            <div className="sm:col-span-2"><Field label="Machine notes (optional)"><Input value={f.machinesNote} onChange={(e) => setF({ ...f, machinesNote: e.target.value })} placeholder="e.g. S02 running warm, watch it" /></Field></div>
            {err && <p className="sm:col-span-2 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
              <Button type="submit">Save handover</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`Recent handovers (${rows.length})`} />
        <TableWrap>
          <thead>
            <tr><Th>Date</Th><Th>Shift</Th><Th>Summary</Th><Th>Pending</Th><Th>By</Th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={5} text="No handovers recorded yet." />
            ) : rows.map((h) => (
              <tr key={h.id}>
                <Td>{formatDate(h.date)}</Td>
                <Td className="capitalize">{h.shift}</Td>
                <Td>
                  {h.summary}
                  {h.machinesNote && <div className="text-xs text-muted">Machines: {h.machinesNote}</div>}
                </Td>
                <Td>{h.pending || "—"}</Td>
                <Td className="text-xs text-muted">{h.byName ?? h.by}<div>{formatDateTime(h.on)}</div></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
