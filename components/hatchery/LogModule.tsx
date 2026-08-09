"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, formatDateTime } from "@/lib/format";
import type { LogEntry } from "@/lib/hatchery/types";

const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

/** Reusable logbook module for biosecurity and maintenance entries. */
export function LogModule({
  title,
  subtitle,
  areaLabel,
  kinds,
  withDowntime,
  logs,
  onSave,
  canAct,
  newId,
}: {
  title: string;
  subtitle?: string;
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
  const [show, setShow] = useState(false);
  const [kind, setKind] = useState(kinds[0]);
  const [area, setArea] = useState("");
  const [notes, setNotes] = useState("");
  const [downtime, setDowntime] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const rows = logs.slice().sort((a, b) => (a.on < b.on ? 1 : -1));

  // Summary.
  const monthKey = nowISO().slice(0, 7);
  const thisMonth = rows.filter((l) => (l.on ?? "").slice(0, 7) === monthKey).length;
  const distinctTypes = new Set(rows.map((l) => l.kind)).size;
  const totalDowntime = rows.reduce((s, l) => s + (l.downtimeHours ?? 0), 0);

  // Filtered + paginated.
  const s = q.trim().toLowerCase();
  const filtered = rows.filter(
    (l) =>
      !s ||
      (l.kind ?? "").toLowerCase().includes(s) ||
      (l.area ?? "").toLowerCase().includes(s) ||
      (l.notes ?? "").toLowerCase().includes(s) ||
      (l.staff ?? "").toLowerCase().includes(s)
  );
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  function openNew() {
    setKind(kinds[0]);
    setArea("");
    setNotes("");
    setDowntime("");
    setErr(null);
    setShow(true);
  }

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
    setShow(false);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {canAct && <Button onClick={openNew}>＋ New entry</Button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoBook />} tone="blue" value={rows.length.toLocaleString()} label="Total entries" />
        <StatCard icon={<IcoCal />} tone="green" value={thisMonth.toLocaleString()} label="This month" />
        <StatCard icon={<IcoTag />} tone="gold" value={distinctTypes.toLocaleString()} label="Types logged" />
        {withDowntime && <StatCard icon={<IcoClock />} tone="red" value={totalDowntime.toLocaleString()} label="Downtime hours" />}
      </div>

      {/* Log */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[0.95rem] font-bold text-ink">Logbook</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search type, area, notes or staff…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>When</th>
              <th className={HG}>Type</th>
              <th className={HG}>{areaLabel}</th>
              <th className={HG}>Notes</th>
              {withDowntime && <th className={`${HG} text-right`}>Downtime (h)</th>}
              <th className={`${HG} last:rounded-tr-lg`}>Staff</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={withDowntime ? 6 : 5} text="No entries yet." />
            ) : (
              pageRows.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(l.on)}</Td>
                  <Td><Pill tone="neutral">{l.kind}</Pill></Td>
                  <Td>{l.area ?? "—"}</Td>
                  <Td>{l.notes}</Td>
                  {withDowntime && <Td className="text-right tabular-nums">{l.downtimeHours ?? 0}</Td>}
                  <Td className="whitespace-nowrap text-xs text-muted">{l.staff}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No entries" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} entries`}</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>‹</Button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, curPage - 3), Math.max(0, curPage - 3) + 5).map((p) => (
                <Button key={p} size="sm" variant={p === curPage ? "primary" : "ghost"} onClick={() => setPage(p)}>{p}</Button>
              ))}
              <Button size="sm" variant="ghost" disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>›</Button>
            </div>
            <label className="flex items-center gap-2">Rows per page:
              <span className="w-20"><Select value={String(perPage)} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))} /></span>
            </label>
          </div>
        </div>
      </Card>

      {/* New entry modal */}
      <Modal open={show && canAct} onClose={() => setShow(false)} title="New log entry" className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select value={kind} onChange={(e) => setKind(e.target.value)} options={kinds.map((k) => ({ value: k, label: k }))} />
            </Field>
            <Field label={areaLabel}>
              <Input value={area} onChange={(e) => setArea(e.target.value)} />
            </Field>
            {withDowntime && (
              <Field label="Downtime (hours)">
                <Input type="number" step="0.5" min={0} value={downtime} onChange={(e) => setDowntime(e.target.value)} />
              </Field>
            )}
          </div>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {err && <p className="text-sm text-status-refunded">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
            <Button type="submit">Save entry</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ---- stat card + icons ----------------------------------------------------

type Tone = "green" | "gold" | "blue" | "red" | "default";
const CHIP: Record<Tone, string> = {
  green: "bg-green-bg text-green", gold: "bg-gold-bg text-gold-dark", blue: "bg-blue-bg text-blue", red: "bg-red-bg text-red", default: "bg-grey-bg text-ink",
};
function StatCard({ icon, value, label, tone = "default" }: { icon: ReactNode; value: string; label: string; tone?: Tone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 shadow-card">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${CHIP[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[1.3rem] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</p>
        <p className="mt-1 truncate text-[0.62rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      </div>
    </div>
  );
}

const lsvg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoBook = () => lsvg(<><path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" /><path d="M5 16h13" /></>);
const IcoCal = () => lsvg(<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M9 3v4M15 3v4" /></>);
const IcoTag = () => lsvg(<><path d="M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8z" /><circle cx="8.5" cy="8.5" r="1.2" /></>);
const IcoClock = () => lsvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
