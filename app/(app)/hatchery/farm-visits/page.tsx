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
import { PRODUCTS, type Product } from "@/lib/types";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import type { FarmVisit } from "@/lib/hatchery/types";

const CAN_ADD = ["Admin", "Hatchery Veterinary"];
const CAN_FORWARD = ["Admin", "Hatchery Veterinary"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

const num = (v: string) => Number(v) || 0;

export default function FarmVisitsPage() {
  const { user } = useAuth();
  const { farmVisits, upsertFarmVisit, newId } = useHatchery();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [f, setF] = useState({
    date: todayISO(), customerName: "", product: "Tetra Super Harco" as Product,
    chicksBought: "", mortality7Day: "", mortalityAfter7Day: "",
    cause: "", problem: "", solution: "", hatcheryCaused: "no",
  });
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const canAdd = !!user && CAN_ADD.includes(user.role);
  const canForward = !!user && CAN_FORWARD.includes(user.role);
  const rows = useMemo(() => farmVisits.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [farmVisits]);

  // Summary.
  const totalChicks = rows.reduce((s, v) => s + (v.chicksBought ?? 0), 0);
  const totalDeaths = rows.reduce((s, v) => s + (v.mortality7Day ?? 0) + (v.mortalityAfter7Day ?? 0), 0);
  const hatcheryCount = rows.filter((v) => v.hatcheryCaused).length;
  const pendingComp = rows.filter((v) => v.hatcheryCaused && !v.sentToSales).length;

  // Filtered + paginated visits.
  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((v) => !needle
    || (v.customerName ?? "").toLowerCase().includes(needle)
    || (v.product ?? "").toLowerCase().includes(needle)
    || (v.cause ?? "").toLowerCase().includes(needle)
    || (v.problem ?? "").toLowerCase().includes(needle));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  if (!user) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.customerName.trim()) return setErr("Enter the customer name.");
    if (num(f.chicksBought) <= 0) return setErr("Enter the number of chicks bought.");
    const on = nowISO();
    const rec: FarmVisit = {
      id: newId("visit"), date: f.date, customerName: f.customerName.trim(), product: f.product,
      chicksBought: num(f.chicksBought), mortality7Day: num(f.mortality7Day), mortalityAfter7Day: num(f.mortalityAfter7Day),
      cause: f.cause.trim(), problem: f.problem.trim(), solution: f.solution.trim(),
      hatcheryCaused: f.hatcheryCaused === "yes", sentToSales: false,
      by: user!.email, on, history: [`${on} — Visit recorded (by ${user!.name})`],
    };
    upsertFarmVisit(rec);
    toast(`Farm visit for ${rec.customerName} recorded.`);
    setShow(false);
    setF({ ...f, customerName: "", chicksBought: "", mortality7Day: "", mortalityAfter7Day: "", cause: "", problem: "", solution: "", hatcheryCaused: "no" });
  }

  function sendToSales(v: FarmVisit) {
    upsertFarmVisit({ ...v, sentToSales: true, history: [...v.history, `${nowISO()} — Report sent to sales for ${v.product} compensation (by ${user!.name})`] });
    toast(`Report sent to sales for ${v.product} compensation.`);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Farm Visits</h1>
          <p className="text-sm text-muted">Log post-sale mortality visits and route hatchery-caused losses to sales</p>
        </div>
        {canAdd && <Button onClick={() => setShow(true)}>＋ Record visit</Button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoClipboard />} tone="blue" value={rows.length.toLocaleString()} label="Visits logged" />
        <StatCard icon={<IcoChick />} tone="green" value={totalChicks.toLocaleString()} label="Chicks covered" />
        <StatCard icon={<IcoSkull />} tone="red" value={totalDeaths.toLocaleString()} label="Deaths reported" />
        <StatCard icon={<IcoAlert />} tone="gold" value={hatcheryCount.toLocaleString()} label="Hatchery-caused" />
        <StatCard icon={<IcoSend />} tone="gold" value={pendingComp.toLocaleString()} label="Pending compensation" />
      </div>

      {/* Visits */}
      <Card>
        <div className="sticky top-16 z-20 -mx-5 -mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border-b border-line bg-paper/95 px-5 pb-3 pt-5 backdrop-blur">
          <h2 className="text-[0.95rem] font-bold text-ink">Farm visits</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search customer, product or cause…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Date</th>
              <th className={HG}>Customer</th>
              <th className={HG}>Product</th>
              <th className={`${HG} text-right`}>Chicks</th>
              <th className={`${HG} text-right`}>≤7d deaths</th>
              <th className={`${HG} text-right`}>&gt;7d deaths</th>
              <th className={HG}>Cause / problem</th>
              <th className={HG}>Hatchery?</th>
              <th className={`${HG} last:rounded-tr-lg`}>Compensation</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={9} text="No farm visits match." />
            ) : pageRows.map((v) => (
              <tr key={v.id}>
                <Td className="whitespace-nowrap">{formatDate(v.date)}</Td>
                <Td className="font-medium text-ink">{v.customerName}</Td>
                <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: v.product === "Ross 308" ? "#1565c0" : "#b8860b" }} />{v.product}</span></Td>
                <Td className="text-right tabular-nums">{v.chicksBought.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{v.mortality7Day.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{v.mortalityAfter7Day.toLocaleString()}</Td>
                <Td className="max-w-[240px]">
                  <div className="text-sm">{v.cause || "—"}</div>
                  {v.problem && <div className="text-xs text-muted">Problem: {v.problem}</div>}
                  {v.solution && <div className="text-xs text-muted">Solution: {v.solution}</div>}
                </Td>
                <Td>{v.hatcheryCaused ? <Pill tone="red">Hatchery</Pill> : <Pill tone="neutral">No</Pill>}</Td>
                <Td>
                  {!v.hatcheryCaused ? (
                    <span className="text-xs text-muted">—</span>
                  ) : v.sentToSales ? (
                    <Pill tone="green">Sent to sales</Pill>
                  ) : canForward ? (
                    <Button size="sm" onClick={() => sendToSales(v)}>Send to sales</Button>
                  ) : (
                    <Pill tone="gold">Pending</Pill>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No visits" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} visits`}</span>
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
        <p className="mt-2 text-xs text-muted">
          Hatchery-caused deaths are sent to sales so the Ross or Tetra salesperson can arrange the customer&apos;s compensation.
        </p>
      </Card>

      {/* Record visit modal */}
      <Modal open={show && canAdd} onClose={() => setShow(false)} title="Record a farm visit" className="max-w-2xl">
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer name"><Input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></Field>
          <Field label="Product"><Select value={f.product} onChange={(e) => setF({ ...f, product: e.target.value as Product })} options={PRODUCTS.map((p) => ({ value: p, label: p }))} /></Field>
          <Field label="Chicks bought"><Input type="number" value={f.chicksBought} onChange={(e) => setF({ ...f, chicksBought: e.target.value })} /></Field>
          <Field label="Date of visit"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Mortality — within 7 days"><Input type="number" value={f.mortality7Day} onChange={(e) => setF({ ...f, mortality7Day: e.target.value })} /></Field>
          <Field label="Mortality — after 7 days"><Input type="number" value={f.mortalityAfter7Day} onChange={(e) => setF({ ...f, mortalityAfter7Day: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Investigated cause of death"><Input value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })} placeholder="What caused the deaths?" /></Field></div>
          <div className="sm:col-span-2"><Field label="Problem"><Input value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Suggested solution"><Input value={f.solution} onChange={(e) => setF({ ...f, solution: e.target.value })} /></Field></div>
          <Field label="Caused by a hatchery problem?" hint="If yes, the report can be sent to sales for compensation.">
            <Select value={f.hatcheryCaused} onChange={(e) => setF({ ...f, hatcheryCaused: e.target.value })} options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes — hatchery problem" }]} />
          </Field>
          {err && <p className="sm:col-span-2 text-sm text-status-refunded">{err}</p>}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
            <Button type="submit">Save visit</Button>
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
const IcoClipboard = () => fsvg(<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9zM9 11h6M9 15h4" /></>);
const IcoChick = () => fsvg(<><circle cx="12" cy="13" r="6" /><path d="M12 7V4M9 13h.01M15 13h.01M12 15l-1.5 2M12 15l1.5 2" /></>);
const IcoSkull = () => fsvg(<><path d="M12 3a7 7 0 0 0-4 12.7V19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.3A7 7 0 0 0 12 3Z" /><circle cx="9.5" cy="12" r="1" /><circle cx="14.5" cy="12" r="1" /></>);
const IcoAlert = () => fsvg(<><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></>);
const IcoSend = () => fsvg(<><path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" /></>);
