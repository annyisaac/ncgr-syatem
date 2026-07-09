"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, formatDateTime } from "@/lib/format";
import type { LogEntry } from "@/lib/hatchery/types";

/** Reusable logbook module for biosecurity and maintenance entries. */
export function LogModule({
  title,
  areaLabel,
  kinds,
  withDowntime,
  logs,
  onSave,
  canAct,
  newId,
}: {
  title: string;
  areaLabel: string;
  kinds: string[];
  withDowntime?: boolean;
  logs: LogEntry[];
  onSave: (l: LogEntry) => void;
  canAct: boolean;
  newId: (p: string) => string;
}) {
  const { user } = useAuth();
  const { recorder } = useOperator();
  const { toast } = useToast();
  const [kind, setKind] = useState(kinds[0]);
  const [area, setArea] = useState("");
  const [notes, setNotes] = useState("");
  const [downtime, setDowntime] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const rows = logs.slice().sort((a, b) => (a.on < b.on ? 1 : -1));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!notes.trim()) return setErr("Enter a note.");
    const entry: LogEntry = {
      id: newId("log"),
      kind,
      area: area.trim() || undefined,
      notes: notes.trim(),
      downtimeHours: withDowntime ? Number(downtime) || 0 : undefined,
      staff: recorder(user!.email),
      on: nowISO(),
    };
    onSave(entry);
    toast("Log entry saved.");
    setNotes("");
    setArea("");
    setDowntime("");
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">{title}</h1>

      {canAct && (
        <Card>
          <CardHeader title="New log entry" />
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                options={kinds.map((k) => ({ value: k, label: k }))}
              />
            </Field>
            <Field label={areaLabel}>
              <Input value={area} onChange={(e) => setArea(e.target.value)} />
            </Field>
            {withDowntime && (
              <Field label="Downtime (hours)">
                <Input type="number" step="0.5" min={0} value={downtime} onChange={(e) => setDowntime(e.target.value)} />
              </Field>
            )}
            <div className={withDowntime ? "sm:col-span-2" : ""}>
              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
            {err && <p className="sm:col-span-2 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit">Save entry</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length} entr${rows.length === 1 ? "y" : "ies"}`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Type</Th>
              <Th>{areaLabel}</Th>
              <Th>Notes</Th>
              {withDowntime && <Th className="text-right">Downtime (h)</Th>}
              <Th>Staff</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={withDowntime ? 6 : 5} text="No entries yet." />
            ) : (
              rows.map((l) => (
                <tr key={l.id}>
                  <Td>{formatDateTime(l.on)}</Td>
                  <Td><Pill tone="neutral">{l.kind}</Pill></Td>
                  <Td>{l.area ?? "—"}</Td>
                  <Td>{l.notes}</Td>
                  {withDowntime && <Td className="text-right">{l.downtimeHours ?? 0}</Td>}
                  <Td>{l.staff}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
