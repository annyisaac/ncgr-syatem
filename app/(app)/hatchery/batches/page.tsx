"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Td, EmptyRow } from "@/components/ui/Table";

import { nowISO, todayISO } from "@/lib/format";
import type { Batch, BatchFlock, MachineAssignment, Reception, SetterMove } from "@/lib/hatchery/types";
import { Modal } from "@/components/ui/Modal";
import { machineFreeCapacity, machinesToSync, markStep, stepLabel, settableEggs, remainingSettable } from "@/lib/hatchery/lifecycle";
import { commitBatchSet, commitBatchDelete } from "@/lib/hatchery/db";
import { batchAvailabilityRow, deliveryDateOf } from "@/lib/projection";

const CAN_SET = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

interface Group {
  key: string; farm: string; flockId: string; product: Reception["productType"]; recs: Reception[];
  eggs: number;
  settableTotal: number; alreadySet: number;
  date: string;
}
interface AssignRow { groupKey: string; machineCode: string; eggs: string; setterOnly?: boolean; }

export default function BatchesPage() {
  const { user } = useAuth();
  const { receptions, machines, batches, newId, reload } = useHatchery();
  const { availability, upsertAvailability } = useData();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [rowsIn, setRowsIn] = useState<AssignRow[]>([{ groupKey: "", machineCode: "", eggs: "" }]);
  const [setDate, setSetDate] = useState(todayISO());
  const [batchCode, setBatchCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [moveB, setMoveB] = useState<Batch | null>(null);
  const [mv, setMv] = useState({ from: "", to: "", eggs: "", trolleys: "" });
  const [mvErr, setMvErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const canSet = !!user && CAN_SET.includes(user.role);
  const isAdmin = !!user && user.role === "Admin";
  const setters = machines.filter((m) => m.type === "setter");

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Reception[]>();
    for (const r of receptions) {
      if (r.location !== "ready" || remainingSettable(r) <= 0) continue;
      const key = `${r.farm}||${r.flockId}||${r.productType}`;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return [...map.entries()].map(([key, recs]) => {
      const settableTotal = recs.reduce((s, r) => s + settableEggs(r), 0);
      const eggs = recs.reduce((s, r) => s + remainingSettable(r), 0);
      return {
        key, farm: recs[0].farm, flockId: recs[0].flockId, product: recs[0].productType,
        recs, eggs, settableTotal, alreadySet: settableTotal - eggs,
        date: recs.map((r) => r.date).sort()[0],
      };
    });
  }, [receptions]);

  const rows = useMemo(() => batches.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [batches]);
  const resolved = useMemo(() => {
    const eff = (i: number) => { for (let j = i; j >= 0; j--) if (!rowsIn[j].setterOnly) return rowsIn[j].groupKey; return ""; };
    return rowsIn.map((r, i) => ({ ...r, groupKey: r.setterOnly ? eff(i) : r.groupKey }));
  }, [rowsIn]);

  const assignedTotal = rowsIn.reduce((s, r) => s + (Number(r.eggs) || 0), 0);
  const flockCount = new Set(resolved.filter((r) => r.groupKey && (Number(r.eggs) || 0) > 0).map((r) => r.groupKey)).size;

  const flockSummary = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resolved) if (r.groupKey) m.set(r.groupKey, (m.get(r.groupKey) ?? 0) + (Number(r.eggs) || 0));
    return [...m.entries()].map(([key, assigned]) => {
      const g = groups.find((x) => x.key === key);
      return { key, label: g ? `${g.farm} · Flock ${g.flockId}` : key, assigned, settable: g?.eggs ?? 0 };
    });
  }, [resolved, groups]);

  const rowFree = (machineCode: string, selfIndex: number) => {
    const m = setters.find((x) => x.code === machineCode);
    if (!m) return 0;
    const claimedElsewhere = rowsIn.reduce((s, r, i) => (i !== selfIndex && r.machineCode === machineCode ? s + (Number(r.eggs) || 0) : s), 0);
    return machineFreeCapacity(m, batches, "setters") - claimedElsewhere;
  };
  const groupFree = (groupKey: string, selfIndex: number) => {
    const g = groups.find((x) => x.key === groupKey);
    if (!g) return 0;
    const claimedElsewhere = resolved.reduce((s, r, i) => (i !== selfIndex && r.groupKey === groupKey ? s + (Number(r.eggs) || 0) : s), 0);
    return g.eggs - claimedElsewhere;
  };

  // Summary + filtered/paginated batches.
  const eggsSetTotal = batches.reduce((s, b) => s + (b.eggsSet || 0), 0);
  const activeBatches = batches.filter((b) => b.status === "active").length;
  const inSetting = batches.filter((b) => b.steps?.["setting"] && !b.steps?.["transfer"]).length;
  const readyEggs = groups.reduce((s, g) => s + g.eggs, 0);
  const qs = q.trim().toLowerCase();
  const filtered = rows.filter((b) => !qs || b.batchNo.toLowerCase().includes(qs) || b.productType.toLowerCase().includes(qs) || b.farm.toLowerCase().includes(qs) || b.flockId.toLowerCase().includes(qs) || stepLabel(b.currentStep).toLowerCase().includes(qs));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  if (!user) return null;

  function addFlock() { setRowsIn([...rowsIn, { groupKey: "", machineCode: "", eggs: "" }]); }
  function addSetter() { setRowsIn([...rowsIn, { groupKey: "", machineCode: "", eggs: "", setterOnly: true }]); }
  function removeRow(i: number) { setRowsIn(rowsIn.length === 1 ? rowsIn : rowsIn.filter((_, j) => j !== i)); }
  function updateRow(i: number, patch: Partial<AssignRow>) { setRowsIn(rowsIn.map((r, j) => (j === i ? { ...r, ...patch } : r))); }
  function openNew() { setRowsIn([{ groupKey: "", machineCode: "", eggs: "" }]); setBatchCode(""); setSetDate(todayISO()); setErr(null); setShow(true); }

  async function createBatch() {
    setErr(null);
    const code = batchCode.trim();
    if (!code) return setErr("Enter a batch code.");
    if (code.length > 15) return setErr("Batch code must be 15 characters or fewer.");
    if (batches.some((b) => b.batchNo.toLowerCase() === code.toLowerCase())) return setErr(`Batch code “${code}” is already used.`);
    const valid = resolved
      .map((r) => ({ groupKey: r.groupKey, machineCode: r.machineCode, eggs: Number(r.eggs) || 0 }))
      .filter((r) => r.groupKey && r.machineCode && r.eggs > 0);
    if (valid.length === 0) return setErr("Add at least one flock with a setter and eggs.");

    const usedGroups = [...new Set(valid.map((r) => r.groupKey))].map((k) => groups.find((g) => g.key === k)!);
    if ([...new Set(usedGroups.map((g) => g.product))].length > 1) return setErr("All flocks in one batch must be the same product.");

    for (const g of usedGroups) {
      const used = valid.filter((r) => r.groupKey === g.key).reduce((s, r) => s + r.eggs, 0);
      if (used > g.eggs) return setErr(`Flock ${g.flockId} (${g.farm}): only ${g.eggs.toLocaleString()} ${g.alreadySet > 0 ? "remaining" : "settable"}.`);
    }
    const perMachine = new Map<string, number>();
    for (const r of valid) perMachine.set(r.machineCode, (perMachine.get(r.machineCode) ?? 0) + r.eggs);
    for (const [mc, eggs] of perMachine) {
      const m = setters.find((x) => x.code === mc)!;
      if (eggs > machineFreeCapacity(m, batches, "setters")) return setErr(`${mc} does not have room for ${eggs.toLocaleString()} eggs.`);
    }

    const recUpdates: { r: Reception; setNow: number }[] = [];
    const plan = usedGroups.map((g) => {
      let toSet = valid.filter((r) => r.groupKey === g.key).reduce((s, r) => s + r.eggs, 0);
      const eggsSet = toSet;
      const contributions: { receptionId: string; eggs: number }[] = [];
      for (const r of g.recs) {
        if (toSet <= 0) break;
        const take = Math.min(remainingSettable(r), toSet);
        if (take <= 0) continue;
        recUpdates.push({ r, setNow: take });
        contributions.push({ receptionId: r.id, eggs: take });
        toSet -= take;
      }
      return { g, eggsSet, contributions };
    });

    const flocks: BatchFlock[] = plan.map(({ g, eggsSet, contributions }) => ({
      flockId: g.flockId, farm: g.farm, ageOfFlock: g.recs[0]?.ageOfFlock ?? 0,
      receptionIds: contributions.map((c) => c.receptionId), receptionSets: contributions,
      eggsSet, candlings: [], transfers: [],
    }));
    const setterList: MachineAssignment[] = valid.map((r) => ({ machineCode: r.machineCode, eggs: r.eggs }));
    const product = usedGroups[0].product;
    const date = setDate || todayISO();
    const totalEggs = flocks.reduce((s, f) => s + f.eggsSet, 0);
    const on = nowISO();
    const id = newId("batch");
    let batch: Batch = {
      id, batchNo: code, setDate: date, productType: product,
      farm: flocks.length === 1 ? flocks[0].farm : "Multiple flocks",
      flockId: flocks.length === 1 ? flocks[0].flockId : `${flocks.length} flocks`,
      receptionIds: flocks.flatMap((f) => f.receptionIds),
      eggsSet: totalEggs, flocks, setters: setterList, transfers: [], candlings: [],
      hatchedCount: 0, culls: 0, unhatchedCount: 0, saleableCount: 0, countedTotal: 0,
      vaccinated: false, currentStep: "setting", status: "active", steps: {},
      history: [`${on} — Batch set: ${totalEggs.toLocaleString()} eggs across ${flocks.length} flock(s) (by ${user!.name})`],
      by: user!.email, createdAt: on,
    };
    batch = markStep(batch, "reception", user!);
    batch = markStep(batch, "setting", user!);

    const receptionRows: Reception[] = recUpdates.map(({ r, setNow }) => {
      const eggsSet = (r.eggsSet ?? 0) + setNow;
      const fullyConsumed = eggsSet >= settableEggs(r);
      return { ...r, eggsSet, batchId: fullyConsumed ? id : r.batchId };
    });
    const machineRows = machinesToSync(machines, setterList.map((s) => s.machineCode), [...batches, batch]);

    // One transaction: batch + receptions + machines commit together or not at
    // all, so a batch can never save while its receptions stay "ready to set".
    try {
      await commitBatchSet(batch, receptionRows, machineRows);
    } catch (e) {
      setErr(`Could not set the batch — nothing was saved, please try again.${e instanceof Error && e.message ? ` (${e.message})` : ""}`);
      return;
    }

    // Availability is a derived sales projection — best-effort, recomputed on
    // later sets, so it never blocks or half-commits the batch.
    const deliveryDate = deliveryDateOf(date);
    const availRow = batchAvailabilityRow(deliveryDate, [...batches, batch], availability.find((a) => a.id === deliveryDate), user!.email, on);
    if (availRow) void upsertAvailability(availRow);

    toast(`Batch ${batch.batchNo} set — ${totalEggs.toLocaleString()} eggs, ${flocks.length} flock(s).`);
    setRowsIn([{ groupKey: "", machineCode: "", eggs: "" }]);
    setBatchCode("");
    setShow(false);
    void reload();
  }

  function openMove(b: Batch) {
    setMoveB(b);
    setMv({ from: b.setters[0]?.machineCode ?? "", to: "", eggs: "", trolleys: "" });
    setMvErr(null);
  }

  async function deleteBatch(b: Batch) {
    const progressed = b.currentStep !== "setting";
    const msg = progressed
      ? `Delete batch ${b.batchNo}?\n\nIt has progressed to “${stepLabel(b.currentStep)}”, so this also discards its candling / transfer / hatch records. Its ${b.eggsSet.toLocaleString()} egg(s) return to the receptions. This cannot be undone.`
      : `Delete batch ${b.batchNo}?\n\nIts ${b.eggsSet.toLocaleString()} set egg(s) return to the receptions so they can be set again. This cannot be undone.`;
    if (!confirm(msg)) return;

    const returns = new Map<string, number>();
    for (const f of b.flocks ?? []) for (const rs of f.receptionSets ?? []) returns.set(rs.receptionId, (returns.get(rs.receptionId) ?? 0) + rs.eggs);
    const ids = new Set<string>([...(b.receptionIds ?? []), ...returns.keys()]);
    const receptionRows: Reception[] = [];
    for (const rid of ids) {
      const r = receptions.find((x) => x.id === rid);
      if (!r) continue;
      const clearBatch = r.batchId === b.id;
      const back = returns.get(rid);
      const eggsSet = back != null ? Math.max(0, (r.eggsSet ?? 0) - back) : clearBatch ? 0 : r.eggsSet;
      if (clearBatch || eggsSet !== r.eggsSet) receptionRows.push({ ...r, eggsSet, batchId: clearBatch ? undefined : r.batchId });
    }
    const affected = (b.setters ?? []).map((s) => s.machineCode);
    const machineRows = affected.length ? machinesToSync(machines, affected, batches.filter((x) => x.id !== b.id)) : [];

    // One transaction: eggs return to the receptions, machines free up, and the
    // batch is removed together — or nothing changes.
    try {
      await commitBatchDelete(b.id, receptionRows, machineRows);
    } catch (e) {
      toast(`Could not delete the batch — nothing was changed.${e instanceof Error && e.message ? ` (${e.message})` : ""}`, "error");
      return;
    }
    toast(`Batch ${b.batchNo} deleted.`);
    void reload();
  }

  async function doMove() {
    if (!moveB) return;
    setMvErr(null);
    const { from, to } = mv;
    const eggs = Number(mv.eggs) || 0;
    const trolleys = Number(mv.trolleys) || 0;
    if (!from) return setMvErr("Choose the setter to move from.");
    if (!to) return setMvErr("Choose the setter to move to.");
    if (from === to) return setMvErr("Pick two different setters.");
    if (eggs <= 0) return setMvErr("Enter the number of eggs on the trolley.");
    const cur = moveB.setters.find((s) => s.machineCode === from);
    if (!cur || eggs > cur.eggs) return setMvErr(`Only ${(cur?.eggs ?? 0).toLocaleString()} eggs in ${from}.`);
    const toMachine = setters.find((m) => m.code === to);
    if (!toMachine) return setMvErr("Destination setter not found.");
    const free = machineFreeCapacity(toMachine, batches, "setters");
    if (eggs > free) return setMvErr(`${to} only has room for ${free.toLocaleString()} more.`);

    const next = moveB.setters
      .map((s) => (s.machineCode === from ? { ...s, eggs: s.eggs - eggs } : s))
      .filter((s) => s.eggs > 0);
    const di = next.findIndex((s) => s.machineCode === to);
    if (di >= 0) next[di] = { ...next[di], eggs: next[di].eggs + eggs };
    else next.push({ machineCode: to, eggs });

    const move: SetterMove = { from, to, eggs, trolleys: trolleys || undefined, on: nowISO(), by: user!.email };
    const nb: Batch = {
      ...moveB, setters: next, setterMoves: [...(moveB.setterMoves ?? []), move],
      history: [...moveB.history, `${nowISO()} — Moved ${eggs.toLocaleString()} eggs${trolleys ? ` (${trolleys} trolley${trolleys > 1 ? "s" : ""})` : ""} from ${from} to ${to} (by ${user!.name})`],
    };
    const machineRows = machinesToSync(machines, [from, to], batches.map((x) => (x.id === nb.id ? nb : x)));

    // One transaction: the batch's new setter split and the two machines commit
    // together — no move partway.
    try {
      await commitBatchSet(nb, [], machineRows);
    } catch (e) {
      setMvErr(`Could not move the eggs — nothing was changed.${e instanceof Error && e.message ? ` (${e.message})` : ""}`);
      return;
    }
    toast(`Moved ${eggs.toLocaleString()} eggs from ${from} to ${to}.`);
    setMoveB(null);
    void reload();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Batches &amp; Setting</h1>
          <p className="text-sm text-muted">Set new batches and track them through the hatchery</p>
        </div>
        {canSet && <Button onClick={openNew}>＋ New Batch</Button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={<IcoTray />} tone="default" value={batches.length.toLocaleString()} label="Total batches" />
        <StatCard icon={<IcoCheck />} tone="green" value={activeBatches.toLocaleString()} label="Active" />
        <StatCard icon={<IcoGear />} tone="blue" value={inSetting.toLocaleString()} label="In setting" />
        <StatCard icon={<IcoEgg />} tone="gold" value={eggsSetTotal.toLocaleString()} label="Eggs set" />
        <StatCard icon={<IcoFlock />} tone="gold" value={groups.length.toLocaleString()} label="Flocks ready" />
        <StatCard icon={<IcoEgg />} tone="green" value={readyEggs.toLocaleString()} label="Eggs ready to set" />
      </div>

      {/* Batches table */}
      <Card>
        <div className="sticky top-16 z-20 -mx-5 -mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border-b border-line bg-paper/95 px-5 pb-3 pt-5 backdrop-blur">
          <h2 className="text-[0.95rem] font-bold text-ink">Batches</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search batch, product, farm, flock, step…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Batch</th>
              <th className={HG}>Product</th>
              <th className={HG}>Farm / flock</th>
              <th className={HG}>Step</th>
              <th className={HG}>Setters</th>
              <th className={`${HG} text-right`}>Eggs set</th>
              <th className={`${HG} text-right`}>Hatched</th>
              <th className={`${HG} text-right`}>Saleable</th>
              <th className={HG}>Status</th>
              {isAdmin && <th className={`${HG} last:rounded-tr-lg text-right`}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={isAdmin ? 10 : 9} text="No batches match." />
            ) : pageRows.map((b) => (
              <tr key={b.id}>
                <Td className="whitespace-nowrap"><Link href={`/hatchery/batches/${b.id}`} className="font-medium text-gold-dark">{b.batchNo}</Link></Td>
                <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: b.productType === "Ross 308" ? "#1565c0" : "#b8860b" }} />{b.productType}</span></Td>
                <Td>{b.flocks && b.flocks.length > 1 ? `${b.flocks.length} flocks` : `${b.farm} · ${b.flockId}`}</Td>
                <Td className="whitespace-nowrap">{stepLabel(b.currentStep)}</Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{b.setters.length ? b.setters.map((s) => `${s.machineCode}·${s.eggs.toLocaleString()}`).join(", ") : "—"}</span>
                    {canSet && b.steps?.["setting"] && !b.steps?.["transfer"] && b.setters.length > 0 && (
                      <div><Button size="sm" variant="ghost" onClick={() => openMove(b)}>Move trolley</Button></div>
                    )}
                  </div>
                </Td>
                <Td className="text-right tabular-nums">{b.eggsSet.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{b.hatchedCount.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{b.saleableCount.toLocaleString()}</Td>
                <Td><Pill tone={b.status === "inactive" ? "neutral" : b.status === "delivered" ? "fulfilled" : b.status === "dispatched" ? "gold" : "green"}>{b.status}</Pill></Td>
                {isAdmin && (
                  <Td className="text-right"><Button size="sm" variant="ghost" className="text-red hover:border-red" onClick={() => deleteBatch(b)}>Delete</Button></Td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No batches" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} batches`}</span>
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

      {/* New batch modal */}
      <Modal open={show && canSet} onClose={() => setShow(false)} title="Set a new batch" className="max-w-3xl">
        {groups.length === 0 ? (
          <p className="text-sm text-muted">No receptions ready to set. Mark receptions “ready to set” on the Egg Reception or Store Room page first.</p>
        ) : setters.length === 0 ? (
          <p className="text-sm text-status-refunded">No setter machines. Create one on the Machines page first.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">Add a flock, then a setter line for it. A flock&apos;s eggs can be split across several setters — use “Add setter” until all its eggs are set. All flocks must be the same product.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={addFlock}>+ Add flock</Button>
                <Button size="sm" variant="ghost" onClick={addSetter}>+ Add setter</Button>
              </div>
            </div>
            {rowsIn.map((row, i) => {
              const eff = resolved[i].groupKey;
              const g = groups.find((x) => x.key === eff);
              return (
                <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1.7fr_1.1fr_0.9fr_auto] sm:items-end">
                  {row.setterOnly ? (
                    <Field label="Flock">
                      <div className="truncate rounded-[9px] border border-line bg-cream/40 px-3.5 py-2.5 text-sm text-muted">↳ {g ? `${g.farm} · Flock ${g.flockId}` : "same flock"}</div>
                    </Field>
                  ) : (
                    <Field label="Flock (farm · flock)">
                      <Select value={row.groupKey} onChange={(e) => updateRow(i, { groupKey: e.target.value })}
                        placeholder="Select flock"
                        options={groups.map((gg) => ({ value: gg.key, label: `${gg.farm} · Flock ${gg.flockId} · ${gg.product} · ${gg.alreadySet > 0 ? `${gg.eggs.toLocaleString()} remaining (of ${gg.settableTotal.toLocaleString()} settable)` : `${gg.eggs.toLocaleString()} settable`}` }))} />
                    </Field>
                  )}
                  <Field label="Setter">
                    <Select value={row.machineCode} onChange={(e) => updateRow(i, { machineCode: e.target.value })}
                      placeholder="Select setter"
                      options={setters.map((m) => ({ value: m.code, label: `${m.code} (free ${Math.max(0, rowFree(m.code, i)).toLocaleString()})` }))} />
                  </Field>
                  <Field label={eff && row.machineCode ? `Eggs (≤ ${Math.max(0, Math.min(groupFree(eff, i), rowFree(row.machineCode, i))).toLocaleString()})` : "Eggs"}>
                    <Input type="number" min={0} value={row.eggs} onChange={(e) => updateRow(i, { eggs: e.target.value })} />
                  </Field>
                  <Button size="sm" variant="ghost" onClick={() => removeRow(i)} disabled={rowsIn.length === 1}>Remove</Button>
                </div>
              );
            })}
            {flockSummary.length > 0 && (
              <div className="space-y-1 rounded-lg border border-line bg-cream/40 p-2.5 text-xs">
                {flockSummary.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-2">
                    <span className="text-muted">{s.label}</span>
                    <span className={s.assigned > s.settable ? "font-semibold text-status-refunded" : s.assigned === s.settable ? "font-semibold text-green" : "text-muted"}>
                      {s.assigned.toLocaleString()} / {s.settable.toLocaleString()} set{s.assigned > s.settable ? " · over!" : s.assigned === s.settable ? " · full ✓" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
              <div className="w-44"><Field label="Set date"><Input type="date" value={setDate} onChange={(e) => setSetDate(e.target.value)} /></Field></div>
              <div className="w-52"><Field label="Batch code (max 15 chars)"><Input value={batchCode} maxLength={15} onChange={(e) => setBatchCode(e.target.value)} placeholder="e.g. R-W29-02" /></Field></div>
            </div>
            <p className="text-sm">Total to set: <strong>{assignedTotal.toLocaleString()}</strong> egg(s) · <strong>{flockCount}</strong> flock(s)</p>
            {err && <p className="text-sm text-status-refunded">{err}</p>}
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
              <Button onClick={createBatch}>Create batch</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Move a trolley between setters */}
      <Modal
        open={!!moveB}
        onClose={() => setMoveB(null)}
        title={moveB ? `Move a trolley — ${moveB.batchNo}` : "Move a trolley"}
        footer={<><Button variant="ghost" onClick={() => setMoveB(null)}>Cancel</Button><Button onClick={doMove}>Move</Button></>}
      >
        {moveB && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="From setter">
              <Select value={mv.from} onChange={(e) => setMv({ ...mv, from: e.target.value })} placeholder="Select"
                options={moveB.setters.map((s) => ({ value: s.machineCode, label: `${s.machineCode} (${s.eggs.toLocaleString()} eggs)` }))} />
            </Field>
            <Field label="To setter">
              <Select value={mv.to} onChange={(e) => setMv({ ...mv, to: e.target.value })} placeholder="Select"
                options={setters.filter((m) => m.code !== mv.from).map((m) => ({ value: m.code, label: `${m.code} (free ${Math.max(0, machineFreeCapacity(m, batches, "setters")).toLocaleString()})` }))} />
            </Field>
            <Field label="Eggs on the trolley"><Input type="number" min={1} value={mv.eggs} onChange={(e) => setMv({ ...mv, eggs: e.target.value })} /></Field>
            <Field label="Trolleys (optional)"><Input type="number" min={0} value={mv.trolleys} onChange={(e) => setMv({ ...mv, trolleys: e.target.value })} /></Field>
            {mvErr && <p className="sm:col-span-2 text-sm text-status-refunded">{mvErr}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---- summary stat card + icons --------------------------------------------

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

const bsvg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoTray = () => bsvg(<><path d="M4 8l8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /></>);
const IcoCheck = () => bsvg(<><circle cx="12" cy="12" r="8" /><path d="M8.5 12l2.5 2.5 4.5-4.5" /></>);
const IcoGear = () => bsvg(<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>);
const IcoEgg = () => bsvg(<ellipse cx="12" cy="13" rx="6" ry="8" />);
const IcoFlock = () => bsvg(<><path d="M4 15a4 4 0 0 1 8 0" /><circle cx="8" cy="8" r="2.5" /><path d="M14 15a4 4 0 0 1 6-3.5" /><circle cx="16.5" cy="8.5" r="2" /></>);
