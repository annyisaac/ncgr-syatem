"use client";

import { useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { CHICKS_PER_BOX, type BoxLog, type BoxTarget, type Supply } from "@/lib/hatchery/types";
import { isoWeek, isoWeekYear } from "@/lib/hatchery/lifecycle";

const CAN_MAKE = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Attendant", "Production Technician"];
// Who sets the weekly target — the hatchery manager and production technician.
const CAN_TARGET = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

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

  const [showLog, setShowLog] = useState(false);
  const [made, setMade] = useState("");
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState<string | null>(null);

  // Weekly target entry
  const [showTarget, setShowTarget] = useState(false);
  const [targetWeekDate, setTargetWeekDate] = useState(todayISO());
  const [targetBoxes, setTargetBoxes] = useState("");
  const [targetErr, setTargetErr] = useState<string | null>(null);

  // Box-making log search + pagination
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

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

  // Summary.
  const totalAssembled = rows.reduce((sum, l) => sum + (l.boxesMade ?? 0), 0);
  const lowStock = boxesNeededThisWeek > 0 && unassembled < boxesNeededThisWeek;

  // Filtered + paginated box-making log.
  const s = q.trim().toLowerCase();
  const filtered = rows.filter((l) => !s || formatDate(l.date).toLowerCase().includes(s) || (l.by ?? "").toLowerCase().includes(s));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

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
      const sup: Supply = {
        ...boxStock, quantity: boxStock.quantity - n,
        history: [...boxStock.history, `${on} — ${n} assembled by ${who} (−${n})`], on,
      };
      upsertSupply(sup);
    }
    toast(`${n} box(es) assembled.`);
    setMade("");
    setShowLog(false);
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
    setShowTarget(false);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Boxes</h1>
          <p className="text-sm text-muted">Assemble chick boxes and set the weekly target</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canTarget && <Button variant="ghost" onClick={() => { setTargetErr(null); setShowTarget(true); }}>＋ Weekly target</Button>}
          {canMake && <Button onClick={() => { setErr(null); setShowLog(true); }}>＋ Log boxes</Button>}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoBox />} tone={lowStock ? "red" : "blue"} value={unassembled.toLocaleString()} label="Unassembled in stock" />
        <StatCard icon={<IcoTarget />} tone="gold" value={boxesNeededThisWeek ? boxesNeededThisWeek.toLocaleString() : "—"} label={`Needed (${thisWeek})`} />
        <StatCard icon={<IcoCheck />} tone="green" value={totalAssembled.toLocaleString()} label="Boxes assembled" />
        <StatCard icon={<IcoChick />} tone="default" value={String(CHICKS_PER_BOX)} label="Chicks per box" />
        <StatCard icon={<IcoCalendar />} tone="blue" value={targetRows.length.toLocaleString()} label="Weekly targets" />
      </div>

      {/* Boxes needed by week */}
      <Card>
        <h2 className="mb-3 text-[0.95rem] font-bold text-ink">Boxes needed by week</h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Week</th>
              <th className={`${HG} text-right`}>Boxes needed</th>
              <th className={HG}>Set by</th>
              <th className={`${HG} last:rounded-tr-lg`}>On</th>
            </tr>
          </thead>
          <tbody>
            {targetRows.length === 0 ? <EmptyRow colSpan={4} text="No weekly targets set yet." /> : targetRows.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.week}{t.week === thisWeek && <Pill tone="gold" className="ml-2">this week</Pill>}</Td>
                <Td className="text-right tabular-nums font-medium">{t.boxes.toLocaleString()}</Td>
                <Td>{t.by}</Td>
                <Td className="whitespace-nowrap">{formatDate(t.on)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {/* Box-making log */}
      <Card>
        <div className="sticky top-16 z-20 -mx-5 -mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border-b border-line bg-paper/95 px-5 pb-3 pt-5 backdrop-blur">
          <h2 className="text-[0.95rem] font-bold text-ink">Box-making log</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search date or person…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Date</th>
              <th className={`${HG} text-right`}>Boxes made</th>
              <th className={`${HG} last:rounded-tr-lg`}>By</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? <EmptyRow colSpan={3} text="No boxes logged yet." /> : pageRows.map((l) => (
              <tr key={l.id}><Td className="whitespace-nowrap">{formatDate(l.date)}</Td><Td className="text-right tabular-nums font-medium">{l.boxesMade}</Td><Td className="whitespace-nowrap text-xs text-muted">{l.by}</Td></tr>
            ))}
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

      {/* Weekly target modal */}
      <Modal open={showTarget && canTarget} onClose={() => setShowTarget(false)} title="Boxes needed this week" className="max-w-2xl">
        <form onSubmit={saveTarget} className="space-y-4">
          <p className="text-xs text-muted">Enter how many boxes are needed for the week. Re-entering a week overwrites its number.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Week (any date in it)"><Input type="date" value={targetWeekDate} onChange={(e) => setTargetWeekDate(e.target.value)} /></Field>
            <Field label={`Boxes needed (${editingWeek})`}>
              <Input type="number" min={0} value={targetBoxes} onChange={(e) => setTargetBoxes(e.target.value)}
                placeholder={editingExisting ? `currently ${editingExisting.boxes}` : "—"} />
            </Field>
          </div>
          {targetErr && <p className="text-sm text-status-refunded">{targetErr}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowTarget(false)}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>

      {/* Log boxes modal */}
      <Modal open={showLog && canMake} onClose={() => setShowLog(false)} title="Log boxes assembled today" className="max-w-2xl">
        {!boxStock ? (
          <p className="text-sm text-status-refunded">Out of unassembled boxes — none in stock. Ask the hatchery manager to add box stock before assembling.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Boxes assembled"><Input type="number" min={0} value={made} onChange={(e) => setMade(e.target.value)} /></Field>
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>
            {err && <p className="text-sm text-status-refunded">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowLog(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}
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

const fsvg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoBox = () => fsvg(<><path d="M3 8l9-4 9 4-9 4-9-4Z" /><path d="M3 8v8l9 4 9-4V8" /><path d="M12 12v8" /></>);
const IcoTarget = () => fsvg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.5" /></>);
const IcoCheck = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M8.5 12l2.5 2.5 4.5-4.5" /></>);
const IcoChick = () => fsvg(<><circle cx="12" cy="11" r="6" /><path d="M12 5V3M9.5 11h.01M14.5 11h.01M12 14l1.5 1.5" /></>);
const IcoCalendar = () => fsvg(<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></>);
