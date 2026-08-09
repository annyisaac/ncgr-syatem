"use client";

import { useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, formatDate } from "@/lib/format";
import type { Operator } from "@/lib/hatchery/types";

const CAN_MANAGE = ["Admin", "Hatchery Manager"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

function genOperatorCode(existing: Operator[]): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "OP-" + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (existing.some((o) => o.code === code));
  return code;
}

export default function OperatorsPage() {
  const { user } = useAuth();
  const { operators, upsertOperator, newId } = useHatchery();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const rows = useMemo(
    () => operators.slice().sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1)),
    [operators]
  );

  // Summary.
  const activeCount = operators.filter((o) => o.active).length;
  const inactiveCount = operators.length - activeCount;
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const newThisMonth = operators.filter((o) => (o.on ?? "").slice(0, 7) === monthPrefix).length;

  // Filtered + paginated attendants.
  const s = q.trim().toLowerCase();
  const filtered = rows.filter((o) => !s || o.name.toLowerCase().includes(s) || o.code.toLowerCase().includes(s));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  if (!user) return null;

  if (!canManage) {
    return (
      <Card>
        <p className="text-sm text-muted">Only the Admin and Hatchery Manager can manage hatchery attendants.</p>
      </Card>
    );
  }

  function openNew() {
    setName(""); setErr(null);
    setShow(true);
  }

  function register(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr("Enter the attendant's name.");
    if (operators.some((o) => o.name.toLowerCase() === name.trim().toLowerCase() && o.active)) return setErr("That attendant already exists.");
    const op: Operator = { id: newId("op"), name: name.trim(), code: genOperatorCode(operators), active: true, by: user!.email, on: nowISO() };
    upsertOperator(op);
    toast(`${op.name} registered — code ${op.code}.`);
    setName("");
    setShow(false);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Hatchery Attendants</h1>
          <p className="text-sm text-muted">Attendants share one tablet login; each proves who they are with a personal code</p>
        </div>
        {canManage && <Button onClick={openNew}>＋ New Attendant</Button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoUsers />} tone="blue" value={operators.length.toLocaleString()} label="Attendants" />
        <StatCard icon={<IcoCheck />} tone="green" value={activeCount.toLocaleString()} label="Active" />
        <StatCard icon={<IcoBan />} tone="default" value={inactiveCount.toLocaleString()} label="Inactive" />
        <StatCard icon={<IcoSpark />} tone="gold" value={newThisMonth.toLocaleString()} label="New this month" />
      </div>

      {/* Attendants */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[0.95rem] font-bold text-ink">{activeCount.toLocaleString()} active attendant(s)</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search name or code…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Name</th>
              <th className={HG}>Code</th>
              <th className={HG}>Registered</th>
              <th className={HG}>Status</th>
              <th className={`${HG} last:rounded-tr-lg text-right`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={5} text="No attendants match." />
            ) : pageRows.map((o) => (
              <tr key={o.id}>
                <Td className="font-medium">{o.name}</Td>
                <Td><span className="rounded bg-cream px-2 py-0.5 font-mono text-sm">{o.code}</span></Td>
                <Td className="whitespace-nowrap">{formatDate(o.on)}</Td>
                <Td>{o.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</Td>
                <Td className="text-right">
                  {o.active
                    ? <Button size="sm" variant="ghost" onClick={() => upsertOperator({ ...o, active: false })}>Deactivate</Button>
                    : <Button size="sm" variant="ghost" onClick={() => upsertOperator({ ...o, active: true })}>Reactivate</Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No attendants" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} attendants`}</span>
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

      {/* Register attendant modal */}
      <Modal open={show && canManage} onClose={() => setShow(false)} title="Register an attendant" className="max-w-2xl">
        <form onSubmit={register} className="space-y-4">
          <p className="text-sm text-muted">
            Register each person here; they enter their code on the tablet to prove who they are, and everything they record is logged under their name.
          </p>
          <Field label="Attendant name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Uwera" /></Field>
          {err && <p className="text-sm text-status-refunded">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
            <Button type="submit">Register &amp; generate code</Button>
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

const fsvg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoUsers = () => fsvg(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M17.5 20a5.5 5.5 0 0 0-3-4.9" /></>);
const IcoCheck = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M8.5 12l2.5 2.5 4.5-4.5" /></>);
const IcoBan = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="m6.5 6.5 11 11" /></>);
const IcoSpark = () => fsvg(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />);
