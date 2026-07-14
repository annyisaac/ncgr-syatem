"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO } from "@/lib/format";
import type { Batch } from "@/lib/hatchery/types";
import { removedInStage, unhatchedFrom, saleableFrom, markStep, hatchabilityPct } from "@/lib/hatchery/lifecycle";

const CAN_ACT = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

export default function HatchPage() {
  const { user } = useAuth();
  const { batches, upsertBatch } = useHatchery();
  const { toast } = useToast();

  const [batchId, setBatchId] = useState("");
  const [hatched, setHatched] = useState("");
  const [culls, setCulls] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canAct = !!user && CAN_ACT.includes(user.role);

  // Ready to hatch = transferred but not hatched. Hatched = hatching step done.
  const ready = useMemo(() => batches.filter((b) => b.steps["transfer"] && !b.steps["hatching"]), [batches]);
  const hatchedRows = useMemo(
    () => batches.filter((b) => b.steps["hatching"]).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [batches]
  );
  const batch = ready.find((b) => b.id === batchId) ?? null;

  const fertile = batch ? batch.eggsSet - removedInStage(batch, 1) - removedInStage(batch, 2) : 0;
  const hatchedN = Number(hatched) || 0;
  const cullsN = Number(culls) || 0;
  const unhatched = batch ? unhatchedFrom(batch, hatchedN) : 0;
  const saleable = saleableFrom(hatchedN, cullsN);

  if (!user) return null;

  function record() {
    setErr(null);
    if (!batch) return;
    if (hatchedN <= 0) return setErr("Enter the number of hatched chicks.");
    if (hatchedN > fertile) return setErr(`Hatched cannot exceed the ${fertile.toLocaleString()} fertile eggs transferred.`);
    if (cullsN > hatchedN) return setErr("Culls cannot exceed hatched chicks.");
    let nb: Batch = {
      ...batch,
      hatchedCount: hatchedN,
      culls: cullsN,
      unhatchedCount: unhatched,
      saleableCount: saleable,
    };
    nb = markStep(nb, "hatching", user!);
    upsertBatch(nb);
    toast(`${hatchedN.toLocaleString()} hatched — ${saleable.toLocaleString()} saleable.`);
    setBatchId(""); setHatched(""); setCulls("");
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Hatch</h1>

      {canAct && (
        <Card>
          <CardHeader title="Record hatch" />
          {ready.length === 0 ? (
            <p className="text-sm text-muted">No batches ready to hatch. Transfer a batch to a hatcher first.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {ready.map((b) => (
                  <button key={b.id} onClick={() => { setBatchId(b.id); setHatched(""); setCulls(""); setErr(null); }}
                    className={`rounded-lg border px-3 py-2 text-sm ${batchId === b.id ? "border-gold bg-gold-bg" : "border-line"}`}>
                    <span className="font-medium">{b.batchNo}</span>
                    <span className="ml-2 text-xs text-muted">{(b.eggsSet - removedInStage(b, 1) - removedInStage(b, 2)).toLocaleString()} fertile</span>
                  </button>
                ))}
              </div>

              {batch && (
                <div className="space-y-3 rounded-lg border border-line p-4">
                  <p className="text-sm text-muted">
                    Eggs set {batch.eggsSet.toLocaleString()} − candling I {removedInStage(batch, 1).toLocaleString()} − candling II {removedInStage(batch, 2).toLocaleString()} = <strong className="text-ink">{fertile.toLocaleString()}</strong> fertile in hatcher.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Hatched chicks"><Input type="number" min={0} value={hatched} onChange={(e) => setHatched(e.target.value)} /></Field>
                    <Field label="Culls (dead / weak)"><Input type="number" min={0} value={culls} onChange={(e) => setCulls(e.target.value)} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <Calc label="Unhatched (auto)" value={unhatched.toLocaleString()} />
                    <Calc label="Saleable" value={saleable.toLocaleString()} strong />
                    <Calc label="Hatchability" value={fertile > 0 ? `${((hatchedN / fertile) * 100).toFixed(0)}%` : "—"} />
                  </div>
                  {err && <p className="text-sm text-status-refunded">{err}</p>}
                  <div className="flex justify-end"><Button onClick={record}>Save hatch result</Button></div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title={`${hatchedRows.length} hatched batch(es)`} />
        <TableWrap>
          <thead><tr><Th>Batch</Th><Th>Product</Th><Th className="text-right">Fertile</Th><Th className="text-right">Hatched</Th><Th className="text-right">Culls</Th><Th className="text-right">Unhatched</Th><Th className="text-right">Saleable</Th><Th className="text-right">Hatch %</Th></tr></thead>
          <tbody>
            {hatchedRows.length === 0 ? <EmptyRow colSpan={8} text="No hatched batches yet." /> : hatchedRows.map((b) => (
              <tr key={b.id}>
                <Td><Link href={`/hatchery/batches/${b.id}`} className="font-medium text-gold-dark underline underline-offset-2">{b.batchNo}</Link></Td>
                <Td>{b.productType}</Td>
                <Td className="text-right">{(b.eggsSet - removedInStage(b, 1) - removedInStage(b, 2)).toLocaleString()}</Td>
                <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
                <Td className="text-right">{b.culls.toLocaleString()}</Td>
                <Td className="text-right">{b.unhatchedCount.toLocaleString()}</Td>
                <Td className="text-right font-medium">{b.saleableCount.toLocaleString()}</Td>
                <Td className="text-right">{hatchabilityPct(b).toFixed(0)}%</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
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
