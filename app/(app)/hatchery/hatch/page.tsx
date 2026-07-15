"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { todayISO, formatDate } from "@/lib/format";
import type { Batch } from "@/lib/hatchery/types";
import { saleableFrom, markStep, expectedHatchDate } from "@/lib/hatchery/lifecycle";

const CAN_ACT = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

/** Eggs physically in the hatcher(s) for a batch = the total transferred. */
const eggsInHatcher = (b: Batch) => b.transfers.reduce((s, a) => s + a.eggs, 0);
const setDateOf = (b: Batch) => (b.steps["setting"]?.on ?? b.createdAt).slice(0, 10);
const hatchDateOf = (b: Batch) => expectedHatchDate(setDateOf(b));
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((new Date(toIso + "T00:00:00").getTime() - new Date(fromIso + "T00:00:00").getTime()) / 86_400_000);

export default function HatchPage() {
  const { user } = useAuth();
  const { batches, upsertBatch } = useHatchery();
  const { toast } = useToast();

  const [sel, setSel] = useState<string | null>(null);
  const [hatched, setHatched] = useState("");
  const [culls, setCulls] = useState("");
  const [err, setErr] = useState<string | null>(null);

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

  const batch = ready.find((b) => b.id === sel) ?? null;
  const inHatcher = batch ? eggsInHatcher(batch) : 0;
  const hatchedN = Number(hatched) || 0;
  const cullsN = Number(culls) || 0;
  const unhatched = Math.max(0, inHatcher - hatchedN);
  const saleable = saleableFrom(hatchedN, cullsN);

  // KPIs
  const eggsInHatchers = ready.reduce((s, b) => s + eggsInHatcher(b), 0);
  const hatchedThisWeek = hatchedRows
    .filter((b) => b.steps["hatching"] && daysBetween(b.steps["hatching"].on.slice(0, 10), today) <= 7)
    .reduce((s, b) => s + b.hatchedCount, 0);
  const avgHatch = useMemo(() => {
    const pcts = hatchedRows.map((b) => (eggsInHatcher(b) > 0 ? (b.hatchedCount / eggsInHatcher(b)) * 100 : 0));
    return pcts.length ? pcts.reduce((s, n) => s + n, 0) / pcts.length : 0;
  }, [hatchedRows]);

  if (!user) return null;

  function openRecord(id: string) { setSel(id); setHatched(""); setCulls(""); setErr(null); }

  function record() {
    setErr(null);
    if (!batch) return;
    if (hatchedN <= 0) return setErr("Enter the number of hatched chicks.");
    if (hatchedN > inHatcher) return setErr(`Hatched cannot exceed the ${inHatcher.toLocaleString()} eggs in the hatcher.`);
    if (cullsN > hatchedN) return setErr("Culls cannot exceed hatched chicks.");
    let nb: Batch = { ...batch, hatchedCount: hatchedN, culls: cullsN, unhatchedCount: unhatched, saleableCount: saleable };
    nb = markStep(nb, "hatching", user!);
    upsertBatch(nb);
    toast(`${hatchedN.toLocaleString()} hatched — ${saleable.toLocaleString()} saleable.`);
    setSel(null); setHatched(""); setCulls("");
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Hatch</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Batches in hatchers" value={ready.length.toLocaleString()} />
        <Kpi label="Eggs in hatchers" value={eggsInHatchers.toLocaleString()} tone="gold" />
        <Kpi label="Hatched this week" value={hatchedThisWeek.toLocaleString()} tone="green" />
        <Kpi label="Avg hatchability" value={`${avgHatch.toFixed(0)}%`} />
      </div>

      {/* Ready to hatch */}
      <Card>
        <CardHeader title={`Ready to hatch (${ready.length})`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Product</Th>
              <Th className="text-right">In hatcher</Th>
              <Th>Expected hatch</Th>
              <Th>Due</Th>
              {canAct && <Th>Action</Th>}
            </tr>
          </thead>
          <tbody>
            {ready.length === 0 ? (
              <EmptyRow colSpan={canAct ? 6 : 5} text="No batches ready to hatch. Transfer a batch to a hatcher first." />
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
                    {canAct && <Td><Button size="sm" onClick={() => openRecord(b.id)}>Record hatch</Button></Td>}
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

      {/* Record hatch modal */}
      {batch && canAct && (
        <Modal
          open
          onClose={() => setSel(null)}
          title={`Record hatch — ${batch.batchNo}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSel(null)}>Cancel</Button>
              <Button onClick={record}>Save hatch result</Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-muted"><strong className="text-ink">{inHatcher.toLocaleString()}</strong> eggs in the hatcher(s) · expected hatch {formatDate(hatchDateOf(batch))}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Hatched chicks"><Input type="number" min={0} value={hatched} onChange={(e) => setHatched(e.target.value)} /></Field>
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

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "gold" | "green" }) {
  const color = tone === "gold" ? "text-gold-dark" : tone === "green" ? "text-green" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paper p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
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
