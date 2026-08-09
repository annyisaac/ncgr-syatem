"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { todayISO, nowISO, formatDate } from "@/lib/format";
import type { Batch } from "@/lib/hatchery/types";
import { saleableFrom, markStep, machinesToSync, expectedHatchDate } from "@/lib/hatchery/lifecycle";

const CAN_ACT = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

const eggsInHatcher = (b: Batch) => b.transfers.reduce((s, a) => s + a.eggs, 0);
const setDateOf = (b: Batch) => (b.steps["setting"]?.on ?? b.createdAt).slice(0, 10);
const hatchDateOf = (b: Batch) => expectedHatchDate(setDateOf(b));
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((new Date(toIso + "T00:00:00").getTime() - new Date(fromIso + "T00:00:00").getTime()) / 86_400_000);
const productDot = (p: string) => (p === "Ross 308" ? "#1565c0" : "#b8860b");

export default function HatchPage() {
  const { user } = useAuth();
  const { batches, machines, upsertBatch, upsertMachine, upsertInventory, newId } = useHatchery();
  const { toast } = useToast();
  const router = useRouter();

  const [sel, setSel] = useState<string | null>(null);
  const [hatched, setHatched] = useState("");
  const [culls, setCulls] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const canAct = !!user && CAN_ACT.includes(user.role);
  const today = todayISO();

  function syncHatchers(nb: Batch) {
    const nextBatches = batches.map((b) => (b.id === nb.id ? nb : b));
    machinesToSync(machines, nb.transfers.map((a) => a.machineCode), nextBatches).forEach(upsertMachine);
  }

  const ready = useMemo(
    () => batches.filter((b) => b.steps["transfer"] && !b.steps["hatching"]).sort((a, b) => (hatchDateOf(a) < hatchDateOf(b) ? -1 : 1)),
    [batches]
  );
  const hatchedRows = useMemo(
    () => batches.filter((b) => b.steps["hatching"]).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [batches]
  );

  const eggsInHatchers = ready.reduce((s, b) => s + eggsInHatcher(b), 0);
  const hatchedThisWeek = hatchedRows
    .filter((b) => b.steps["hatching"] && daysBetween(b.steps["hatching"].on.slice(0, 10), today) <= 7)
    .reduce((s, b) => s + b.hatchedCount, 0);
  const avgHatch = useMemo(() => {
    const pcts = hatchedRows.map((b) => (eggsInHatcher(b) > 0 ? (b.hatchedCount / eggsInHatcher(b)) * 100 : 0));
    return pcts.length ? pcts.reduce((s, n) => s + n, 0) / pcts.length : 0;
  }, [hatchedRows]);

  const batch = ready.find((b) => b.id === sel) ?? null;
  const inHatcher = batch ? eggsInHatcher(batch) : 0;
  const hatchedN = Number(hatched) || 0;
  const cullsN = Number(culls) || 0;
  const unhatched = Math.max(0, inHatcher - hatchedN);
  const saleable = saleableFrom(hatchedN, cullsN);

  // Filter + paginate the hatched batches.
  const s = q.trim().toLowerCase();
  const filtered = hatchedRows.filter((b) => !s || b.batchNo.toLowerCase().includes(s) || b.productType.toLowerCase().includes(s));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  if (!user) return null;

  function openRecord(id: string) { setSel(id); setHatched(""); setCulls(""); setErr(null); }
  function openBatch(id: string) { router.push(`/hatchery/batches/${id}`); }

  function record() {
    setErr(null);
    if (!batch) return;
    if (hatchedN <= 0) return setErr("Enter the number of hatched chicks.");
    if (hatchedN > inHatcher) return setErr(`Hatched cannot exceed the ${inHatcher.toLocaleString()} in the hatcher.`);
    if (cullsN > hatchedN) return setErr("Culls cannot exceed hatched chicks.");
    let nb: Batch = { ...batch, hatchedCount: hatchedN, culls: cullsN, unhatchedCount: unhatched, saleableCount: saleable, countedTotal: saleable };
    nb = markStep(nb, "hatching", user!);
    nb = markStep(nb, "counting", user!);
    upsertBatch(nb);
    upsertInventory({ id: newId("inv"), productType: nb.productType, hatchDate: todayISO(), availableCount: saleable, batchId: nb.id, updatedBy: user!.email, on: nowISO() });
    syncHatchers(nb);
    toast(`${batch.batchNo} hatched — ${saleable.toLocaleString()} saleable.`);
    setSel(null); setHatched(""); setCulls("");
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Hatch</h1>
        <p className="text-sm text-muted">Record the hatch count as each batch completes incubation, and track hatchability.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoBox />} tone="blue" value={ready.length.toLocaleString()} label="Batches in hatchers" />
        <StatCard icon={<IcoEgg />} tone="gold" value={eggsInHatchers.toLocaleString()} label="Eggs in hatchers" />
        <StatCard icon={<IcoChick />} tone="green" value={hatchedThisWeek.toLocaleString()} label="Hatched this week" />
        <StatCard icon={<IcoPercent />} tone="gold" value={`${avgHatch.toFixed(0)}%`} label="Avg hatchability" />
        <StatCard icon={<IcoChick />} tone="default" value={hatchedRows.length.toLocaleString()} label="Hatched batches" />
      </div>

      {/* In hatchers — record the count */}
      <Card>
        <h2 className="text-[0.95rem] font-bold text-ink">In hatchers — record count ({ready.length})</h2>
        <p className="mb-3 mt-0.5 text-xs text-muted">Count the chicks from the machines, then record the total — that count is the batch&apos;s hatch result.</p>
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th><Th>Product</Th><Th className="text-right">In hatcher</Th><Th>Expected hatch</Th><Th>Due</Th>{canAct && <Th>Action</Th>}
            </tr>
          </thead>
          <tbody>
            {ready.length === 0 ? (
              <EmptyRow colSpan={canAct ? 6 : 5} text="No batches in hatchers. Transfer a batch to a hatcher first." />
            ) : ready.map((b) => {
              const dLeft = daysBetween(today, hatchDateOf(b));
              const due = dLeft < 0 ? { label: `Overdue ${Math.abs(dLeft)}d`, tone: "red" as const }
                : dLeft === 0 ? { label: "Due today", tone: "amber" as const }
                : { label: `${dLeft} day${dLeft === 1 ? "" : "s"} left`, tone: "green" as const };
              return (
                <tr key={b.id} onClick={() => openBatch(b.id)} className="cursor-pointer transition hover:bg-cream/50">
                  <Td className="whitespace-nowrap"><span className="font-medium text-gold-dark">{b.batchNo}</span></Td>
                  <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: productDot(b.productType) }} />{b.productType}</span></Td>
                  <Td className="text-right tabular-nums">{eggsInHatcher(b).toLocaleString()}</Td>
                  <Td className="whitespace-nowrap">{formatDate(hatchDateOf(b))}</Td>
                  <Td><Pill tone={due.tone}>{due.label}</Pill></Td>
                  {canAct && <Td><div onClick={(e) => e.stopPropagation()}><Button size="sm" onClick={() => openRecord(b.id)}>Record count</Button></div></Td>}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {/* Hatched batches */}
      <Card>
        <div className="sticky top-16 z-20 -mx-5 -mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border-b border-line bg-paper/95 px-5 pb-3 pt-5 backdrop-blur">
          <h2 className="text-[0.95rem] font-bold text-ink">Hatched batches</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search batch or product…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th><Th>Product</Th><Th className="text-right">In hatcher</Th><Th className="text-right">Hatched</Th>
              <Th className="text-right">Culls</Th><Th className="text-right">Unhatched</Th><Th className="text-right">Saleable</Th><Th className="text-right">Hatch %</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? <EmptyRow colSpan={8} text="No hatched batches yet." /> : pageRows.map((b) => {
              const inH = eggsInHatcher(b);
              const pct = inH > 0 ? (b.hatchedCount / inH) * 100 : 0;
              return (
                <tr key={b.id} onClick={() => openBatch(b.id)} className="cursor-pointer transition hover:bg-cream/50">
                  <Td className="whitespace-nowrap"><span className="font-medium text-gold-dark">{b.batchNo}</span></Td>
                  <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: productDot(b.productType) }} />{b.productType}</span></Td>
                  <Td className="text-right tabular-nums">{inH.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{b.hatchedCount.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{b.culls.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{b.unhatchedCount.toLocaleString()}</Td>
                  <Td className="text-right font-medium tabular-nums text-green">{b.saleableCount.toLocaleString()}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2 tabular-nums">
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-green" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                      {pct.toFixed(0)}%
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No hatched batches" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} batches`}</span>
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

      {/* Record count modal */}
      {batch && canAct && (
        <Modal
          open
          onClose={() => setSel(null)}
          title={`Record count — ${batch.batchNo}`}
          footer={<><Button variant="ghost" onClick={() => setSel(null)}>Cancel</Button><Button onClick={record}>Save hatch result</Button></>}
        >
          <div className="space-y-3">
            <p className="text-sm text-muted"><strong className="text-ink">{inHatcher.toLocaleString()}</strong> eggs in the hatcher(s) · expected hatch {formatDate(hatchDateOf(batch))}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Hatched chicks (counted)"><Input type="number" min={0} value={hatched} onChange={(e) => setHatched(e.target.value)} /></Field>
              <Field label="Culls (dead / weak)"><Input type="number" min={0} value={culls} onChange={(e) => setCulls(e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Calc label="Unhatched (auto)" value={unhatched.toLocaleString()} />
              <Calc label="Saleable" value={saleable.toLocaleString()} strong />
              <Calc label="Hatchability" value={inHatcher > 0 ? `${((hatchedN / inHatcher) * 100).toFixed(0)}%` : "—"} />
            </div>
            {err && <p className="text-sm text-status-refunded">{err}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Calc({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={strong ? "text-lg font-bold text-ink" : "font-medium text-ink"}>{value}</p>
    </div>
  );
}

type CardTone = "green" | "gold" | "blue" | "red" | "default";
const CARD_CHIP: Record<CardTone, string> = {
  green: "bg-green-bg text-green", gold: "bg-gold-bg text-gold-dark", blue: "bg-blue-bg text-blue", red: "bg-red-bg text-red", default: "bg-grey-bg text-ink",
};
function StatCard({ icon, value, label, tone = "default" }: { icon: ReactNode; value: string; label: string; tone?: CardTone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 shadow-card">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${CARD_CHIP[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[1.3rem] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</p>
        <p className="mt-1 truncate text-[0.62rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      </div>
    </div>
  );
}

const hsvg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoBox = () => hsvg(<><path d="M4 8l8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /></>);
const IcoEgg = () => hsvg(<ellipse cx="12" cy="13" rx="6" ry="8" />);
const IcoChick = () => hsvg(<><ellipse cx="12" cy="13.5" rx="6" ry="7" /><path d="M12 6.5V4" /><circle cx="10" cy="12" r=".6" fill="currentColor" /></>);
const IcoPercent = () => hsvg(<><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2" /><circle cx="16.5" cy="16.5" r="2" /></>);
