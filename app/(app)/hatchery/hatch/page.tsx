"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { todayISO, nowISO, formatDate } from "@/lib/format";
import type { Batch, ChickCount } from "@/lib/hatchery/types";
import { markStep, machinesToSync, expectedHatchDate, batchFlocks, flockTransferred } from "@/lib/hatchery/lifecycle";

const CAN_ACT = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

/** Eggs physically in the hatcher(s) for a batch = the total transferred. */
const eggsInHatcher = (b: Batch) => b.transfers.reduce((s, a) => s + a.eggs, 0);
const setDateOf = (b: Batch) => (b.steps["setting"]?.on ?? b.createdAt).slice(0, 10);
const hatchDateOf = (b: Batch) => expectedHatchDate(setDateOf(b));
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((new Date(toIso + "T00:00:00").getTime() - new Date(fromIso + "T00:00:00").getTime()) / 86_400_000);

export default function HatchPage() {
  const { user } = useAuth();
  const { batches, machines, counts, upsertBatch, upsertCount, upsertMachine, upsertInventory, newId } = useHatchery();

  /** After a batch hatches, its hatcher(s) are empty → set them inactive. */
  function syncHatchers(nb: Batch) {
    const nextBatches = batches.map((b) => (b.id === nb.id ? nb : b));
    machinesToSync(machines, nb.transfers.map((a) => a.machineCode), nextBatches).forEach(upsertMachine);
  }
  const { toast } = useToast();

  const canAct = !!user && CAN_ACT.includes(user.role);
  const today = todayISO();

  // Ready to hatch = transferred but not hatched, soonest due first.
  const ready = useMemo(
    () =>
      batches
        .filter((b) => b.steps["transfer"] && !b.steps["hatching"])
        .sort((a, b) => (hatchDateOf(a) < hatchDateOf(b) ? -1 : 1)),
    [batches]
  );
  const hatchedRows = useMemo(
    () => batches.filter((b) => b.steps["hatching"]).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [batches]
  );

  // KPIs
  const eggsInHatchers = ready.reduce((s, b) => s + eggsInHatcher(b), 0);
  const hatchedThisWeek = hatchedRows
    .filter((b) => b.steps["hatching"] && daysBetween(b.steps["hatching"].on.slice(0, 10), today) <= 7)
    .reduce((s, b) => s + b.hatchedCount, 0);
  const avgHatch = useMemo(() => {
    const pcts = hatchedRows.map((b) => (eggsInHatcher(b) > 0 ? (b.hatchedCount / eggsInHatcher(b)) * 100 : 0));
    return pcts.length ? pcts.reduce((s, n) => s + n, 0) / pcts.length : 0;
  }, [hatchedRows]);

  // Attendants' per-flock counts awaiting Production Technician verification.
  const pendingCounts = useMemo(() => counts.filter((c) => !c.verified).sort((a, b) => (a.on < b.on ? 1 : -1)), [counts]);
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;

  // Per-flock verified results, for monitoring each flock's performance.
  const flockResults = useMemo(() => {
    const out: { id: string; batchNo: string; farm: string; flockId: string; inH: number; hatched: number; culls: number; saleable: number; hatchability: number; on: string }[] = [];
    for (const c of counts.filter((x) => x.verified)) {
      const b = batches.find((x) => x.id === c.batchId);
      if (!b) continue;
      const f = batchFlocks(b).find((x) => x.flockId === c.flockId);
      const inH = f ? flockTransferred(f) : 0;
      const culls = (c.culls ?? 0) + (c.vaxCulls ?? 0);
      const hatched = c.total + (c.culls ?? 0);
      out.push({
        id: c.id, batchNo: b.batchNo, farm: f?.farm ?? "", flockId: c.flockId ?? "—",
        inH, hatched, culls, saleable: Math.max(0, c.total - (c.vaxCulls ?? 0)),
        hatchability: inH > 0 ? (hatched / inH) * 100 : 0, on: c.on,
      });
    }
    return out.sort((a, b) => (a.on < b.on ? 1 : -1));
  }, [counts, batches]);

  if (!user) return null;

  /** Verify one flock's count → it becomes the batch's hatch result; when every
   *  flock is verified, mark the batch hatched + counted and create inventory. */
  function verifyCount(c: ChickCount) {
    const b = batches.find((x) => x.id === c.batchId);
    if (!b) return;
    const vc: ChickCount = { ...c, verified: true, verifiedBy: user!.email, verifiedOn: nowISO() };
    upsertCount(vc);
    const verified = counts.filter((x) => x.batchId === b.id).map((x) => (x.id === c.id ? vc : x)).filter((x) => x.verified);
    const saleableTot = verified.reduce((s, x) => s + x.total, 0);
    const cullsTot = verified.reduce((s, x) => s + (x.culls ?? 0), 0);
    const hatchedTot = saleableTot + cullsTot;
    const inH = eggsInHatcher(b);
    let nb: Batch = { ...b, hatchedCount: hatchedTot, culls: cullsTot, saleableCount: saleableTot, countedTotal: saleableTot, unhatchedCount: Math.max(0, inH - hatchedTot) };
    const countableFlocks = batchFlocks(b).filter((f) => flockTransferred(f) > 0);
    const allDone = countableFlocks.every((f) => verified.some((x) => x.flockId === f.flockId));
    if (allDone && !nb.steps["hatching"]) {
      nb = markStep(nb, "hatching", user!);
      nb = markStep(nb, "counting", user!);
      upsertInventory({ id: newId("inv"), productType: nb.productType, hatchDate: todayISO(), availableCount: saleableTot, batchId: nb.id, updatedBy: user!.email, on: nowISO() });
    }
    upsertBatch(nb);
    syncHatchers(nb);
    toast(allDone ? `${b.batchNo} fully verified — ${saleableTot.toLocaleString()} saleable.` : `Flock ${c.flockId} verified.`);
  }


  return (
    <div className="space-y-5">

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Batches in hatchers" value={ready.length.toLocaleString()} />
        <Kpi label="Eggs in hatchers" value={eggsInHatchers.toLocaleString()} tone="gold" />
        <Kpi label="Counts to verify" value={pendingCounts.length.toLocaleString()} tone={pendingCounts.length ? "gold" : undefined} />
        <Kpi label="Hatched this week" value={hatchedThisWeek.toLocaleString()} tone="green" />
        <Kpi label="Avg hatchability" value={`${avgHatch.toFixed(0)}%`} />
      </div>

      {/* Counts to verify (Production Technician / managers) */}
      {canAct && (
        <Card>
          <CardHeader title={`Counts to verify (${pendingCounts.length})`} />
          <p className="-mt-1 mb-2 text-xs text-muted">Attendants&apos; per-flock counts. Verify to make them the batch&apos;s hatch result — culls are removed again at vaccination for the final saleable.</p>
          <TableWrap>
            <thead>
              <tr><Th>Batch</Th><Th>Flock</Th><Th className="text-right">Saleable</Th><Th className="text-right">Culls</Th><Th className="text-right">Hatched</Th><Th>Counted by</Th><Th>Action</Th></tr>
            </thead>
            <tbody>
              {pendingCounts.length === 0 ? (
                <EmptyRow colSpan={7} text="No counts awaiting verification." />
              ) : (
                pendingCounts.map((c) => (
                  <tr key={c.id}>
                    <Td className="font-medium">{batchNo(c.batchId)}</Td>
                    <Td>{c.flockId ?? "—"}</Td>
                    <Td className="text-right font-medium">{c.total.toLocaleString()}</Td>
                    <Td className="text-right">{(c.culls ?? 0).toLocaleString()}</Td>
                    <Td className="text-right">{(c.total + (c.culls ?? 0)).toLocaleString()}</Td>
                    <Td className="text-muted">{c.by}</Td>
                    <Td><Button size="sm" onClick={() => verifyCount(c)}>Verify</Button></Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {/* In hatchers — awaiting count */}
      <Card>
        <CardHeader title={`In hatchers — awaiting count (${ready.length})`} />
        <p className="-mt-1 mb-2 text-xs text-muted">The chicks are counted box by box on the <Link href="/hatchery/counting" className="text-gold-dark underline">Counting</Link> page; those counts become the batch&apos;s hatch result once verified above.</p>
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Product</Th>
              <Th className="text-right">In hatcher</Th>
              <Th>Expected hatch</Th>
              <Th>Due</Th>
            </tr>
          </thead>
          <tbody>
            {ready.length === 0 ? (
              <EmptyRow colSpan={5} text="No batches in hatchers. Transfer a batch to a hatcher first." />
            ) : (
              ready.map((b) => {
                const dLeft = daysBetween(today, hatchDateOf(b));
                const due = dLeft < 0 ? { label: `overdue ${Math.abs(dLeft)}d`, tone: "red" as const }
                  : dLeft === 0 ? { label: "due today", tone: "gold" as const }
                  : { label: `${dLeft} day${dLeft === 1 ? "" : "s"} left`, tone: "info" as const };
                return (
                  <tr key={b.id}>
                    <Td className="font-medium">
                      <Link href={`/hatchery/batches/${b.id}`} className="text-gold-dark underline underline-offset-2">{b.batchNo}</Link>
                    </Td>
                    <Td>{b.productType}</Td>
                    <Td className="text-right">{eggsInHatcher(b).toLocaleString()}</Td>
                    <Td>{formatDate(hatchDateOf(b))}</Td>
                    <Td><Pill tone={due.tone}>{due.label}</Pill></Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {/* Hatched batches */}
      <Card>
        <CardHeader title={`${hatchedRows.length} hatched batch(es)`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th><Th>Product</Th><Th className="text-right">In hatcher</Th><Th className="text-right">Hatched</Th>
              <Th className="text-right">Culls</Th><Th className="text-right">Unhatched</Th><Th className="text-right">Saleable</Th><Th className="text-right">Hatch %</Th>
            </tr>
          </thead>
          <tbody>
            {hatchedRows.length === 0 ? <EmptyRow colSpan={8} text="No hatched batches yet." /> : hatchedRows.map((b) => {
              const inH = eggsInHatcher(b);
              const pct = inH > 0 ? (b.hatchedCount / inH) * 100 : 0;
              return (
                <tr key={b.id}>
                  <Td><Link href={`/hatchery/batches/${b.id}`} className="font-medium text-gold-dark underline underline-offset-2">{b.batchNo}</Link></Td>
                  <Td>{b.productType}</Td>
                  <Td className="text-right">{inH.toLocaleString()}</Td>
                  <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
                  <Td className="text-right">{b.culls.toLocaleString()}</Td>
                  <Td className="text-right">{b.unhatchedCount.toLocaleString()}</Td>
                  <Td className="text-right font-medium">{b.saleableCount.toLocaleString()}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-green" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      {pct.toFixed(0)}%
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {/* Per-flock results — monitor each flock's performance */}
      <Card>
        <CardHeader title={`Flock results (${flockResults.length})`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th><Th>Flock</Th><Th className="text-right">In hatcher</Th><Th className="text-right">Hatched</Th>
              <Th className="text-right">Culls</Th><Th className="text-right">Final saleable</Th><Th className="text-right">Hatchability</Th>
            </tr>
          </thead>
          <tbody>
            {flockResults.length === 0 ? <EmptyRow colSpan={7} text="No verified flock counts yet." /> : flockResults.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.batchNo}</Td>
                <Td>{r.farm} · {r.flockId}</Td>
                <Td className="text-right">{r.inH.toLocaleString()}</Td>
                <Td className="text-right">{r.hatched.toLocaleString()}</Td>
                <Td className="text-right">{r.culls.toLocaleString()}</Td>
                <Td className="text-right font-medium">{r.saleable.toLocaleString()}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-green" style={{ width: `${Math.min(100, r.hatchability)}%` }} />
                    </div>
                    {r.hatchability.toFixed(0)}%
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "gold" | "green" }) {
  const color = tone === "gold" ? "text-gold-dark" : tone === "green" ? "text-green" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paper p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
