"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { nowISO, formatDate, formatDateTime } from "@/lib/format";

import type { Candling, ChickInventory } from "@/lib/hatchery/types";
import { LIFECYCLE_STEPS } from "@/lib/hatchery/types";
import {
  markStep,
  fertilityPct,
  hatchabilityPct,
  gradeAPct,
} from "@/lib/hatchery/lifecycle";

const CAN_ADVANCE = [
  "Admin",
  "Hatchery Manager",
  "Hatchery Operations Manager",
  "Production Technician",
];

type StepModal = null | "candling-1" | "candling-2" | "hatching" | "grading";

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const { batches, inventory, upsertBatch, upsertInventory, newId } = useHatchery();
  const { toast } = useToast();
  const [modal, setModal] = useState<StepModal>(null);

  const batch = batches.find((b) => b.id === params.id);
  const canAct = !!user && CAN_ADVANCE.includes(user.role);

  if (!user) return null;
  if (!batch) {
    return (
      <div className="space-y-4">
        <Link href="/hatchery/batches" className="text-sm text-gold-dark underline">← Back to batches</Link>
        <Card><p className="text-sm text-muted">Batch not found.</p></Card>
      </div>
    );
  }

  const nextStep = LIFECYCLE_STEPS.find((s) => !batch.steps[s.key]);
  const inv = inventory.find((i) => i.batchId === batch.id);
  const graded = !!batch.steps["grading"];
  const vaccinated = !!batch.steps["vaccination"];

  function completeSimpleStep() {
    if (!nextStep) return;
    upsertBatch(markStep(batch!, nextStep.key, user!));
    toast(`${nextStep.label} recorded.`);
  }

  function saveCandling(stage: 1 | 2, fertileKept: number, removed: number) {
    const c: Candling = {
      stage,
      day: stage === 1 ? 10 : 18,
      date: stage === 1 ? batch!.candling1Date : batch!.candling2Date,
      fertileKept,
      removed,
      by: user!.email,
      on: nowISO(),
    };
    const marked = markStep(
      { ...batch!, fertileCount: fertileKept, candlings: [...batch!.candlings, c] },
      stage === 1 ? "candling-1" : "candling-2",
      user!
    );
    upsertBatch(marked);
    toast(`Candling ${stage} recorded — ${fertileKept} fertile kept, ${removed} removed.`);
    setModal(null);
  }

  function saveHatching(hatched: number) {
    upsertBatch(markStep({ ...batch!, hatchedCount: hatched }, "hatching", user!));
    toast(`Hatching recorded — ${hatched} chicks.`);
    setModal(null);
  }

  function saveGrading(gradeA: number) {
    const sellable = Math.max(0, gradeA - batch!.rejectedCount);
    upsertBatch(markStep({ ...batch!, gradeAcount: gradeA, sellableCount: sellable }, "grading", user!));
    toast(`Grading recorded — ${gradeA} Grade A.`);
    setModal(null);
  }

  function publishInventory() {
    const sellable = Math.max(0, batch!.gradeAcount - batch!.rejectedCount);
    const row: ChickInventory = {
      id: inv?.id ?? newId("inv"),
      productType: batch!.productType,
      hatchDate: batch!.expectedHatchDate,
      availableCount: sellable,
      batchId: batch!.id,
      updatedBy: user!.email,
      on: nowISO(),
    };
    upsertInventory(row);
    upsertBatch({ ...batch!, sellableCount: sellable });
    toast(`Published ${sellable} sellable chicks to inventory.`);
  }

  function onStepAction() {
    if (!nextStep) return;
    if (nextStep.key === "candling-1") setModal("candling-1");
    else if (nextStep.key === "candling-2") setModal("candling-2");
    else if (nextStep.key === "hatching") setModal("hatching");
    else if (nextStep.key === "grading") setModal("grading");
    else completeSimpleStep();
  }

  return (
    <div className="space-y-5">
      <Link href="/hatchery/batches" className="text-sm text-gold-dark underline">← Back to batches</Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">{batch.batchNo}</h1>
        <Pill tone={batch.status === "delivered" ? "fulfilled" : batch.status === "dispatched" ? "gold" : "info"}>
          {batch.status}
        </Pill>
      </div>

      <Card>
        <CardHeader title="Batch" />
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Info label="Product" value={batch.productType} />
          <Info label="Egg source" value={batch.eggSource} />
          <Info label="Eggs set" value={batch.eggCount.toLocaleString()} />
          <Info label="Incubator" value={batch.incubator ?? "—"} />
          <Info label="Set date" value={formatDate(batch.setDate)} />
          <Info label="Candling 1" value={formatDate(batch.candling1Date)} />
          <Info label="Candling 2" value={formatDate(batch.candling2Date)} />
          <Info label="Expected hatch" value={formatDate(batch.expectedHatchDate)} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-md bg-ink/5 p-3 text-sm sm:grid-cols-4">
          <Info label="Fertile (running)" value={`${batch.fertileCount.toLocaleString()} (${fertilityPct(batch).toFixed(0)}%)`} />
          <Info label="Hatched" value={`${batch.hatchedCount.toLocaleString()} (${hatchabilityPct(batch).toFixed(0)}%)`} />
          <Info label="Grade A" value={`${batch.gradeAcount.toLocaleString()} (${gradeAPct(batch).toFixed(0)}%)`} />
          <Info label="Sellable" value={`${batch.sellableCount.toLocaleString()}${batch.rejectedCount ? ` · ${batch.rejectedCount} rejected` : ""}`} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Lifecycle"
          action={
            canAct && nextStep ? (
              <Button size="sm" onClick={onStepAction}>Complete: {nextStep.label}</Button>
            ) : undefined
          }
        />
        <ol className="space-y-1.5">
          {LIFECYCLE_STEPS.map((s) => {
            const mark = batch.steps[s.key];
            const isNext = nextStep?.key === s.key;
            return (
              <li
                key={s.key}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
                  mark ? "border-green/30 bg-green-bg" : isNext ? "border-gold bg-gold-bg" : "border-line"
                )}
              >
                <span className="font-medium">
                  {mark ? "✓ " : isNext ? "→ " : ""}{s.label}
                </span>
                {mark && (
                  <span className="text-xs text-muted">{formatDateTime(mark.on)} · {mark.by}</span>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      {batch.candlings.length > 0 && (
        <Card>
          <CardHeader title="Candling records" />
          <div className="space-y-2 text-sm">
            {batch.candlings.map((c, i) => (
              <div key={i} className="flex flex-wrap justify-between gap-2 rounded-md border border-line px-3 py-2">
                <span>Candling {c.stage} (day {c.day}) · {formatDate(c.date)}</span>
                <span className="text-muted">{c.fertileKept} fertile kept · {c.removed} removed · {c.by}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Available chicks (sales inventory)" />
        {graded && vaccinated ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {inv
                ? `${inv.availableCount.toLocaleString()} chicks available (updated ${formatDateTime(inv.on)}).`
                : "Not yet published to inventory."}
            </p>
            {canAct && (
              <Button onClick={publishInventory}>
                {inv ? "Update available chicks" : "Publish available chicks"}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">
            Available once the batch is graded and vaccinated.
          </p>
        )}
      </Card>

      {(modal === "candling-1" || modal === "candling-2") && (
        <CandlingModal
          stage={modal === "candling-1" ? 1 : 2}
          fertileBefore={batch.fertileCount}
          onClose={() => setModal(null)}
          onSave={saveCandling}
        />
      )}
      {modal === "hatching" && (
        <NumberModal
          title="Record hatching"
          label="Chicks hatched"
          max={batch.fertileCount}
          onClose={() => setModal(null)}
          onSave={saveHatching}
        />
      )}
      {modal === "grading" && (
        <NumberModal
          title="Record grading"
          label="Grade A chicks"
          max={batch.hatchedCount}
          onClose={() => setModal(null)}
          onSave={saveGrading}
        />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}

function CandlingModal({
  stage,
  fertileBefore,
  onClose,
  onSave,
}: {
  stage: 1 | 2;
  fertileBefore: number;
  onClose: () => void;
  onSave: (stage: 1 | 2, fertileKept: number, removed: number) => void;
}) {
  const [removed, setRemoved] = useState("");
  const kept = Math.max(0, fertileBefore - (Number(removed) || 0));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Candling ${stage} (day ${stage === 1 ? 10 : 18})`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(stage, kept, Number(removed) || 0)}>Save candling</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">Fertile before: <strong>{fertileBefore.toLocaleString()}</strong></p>
        <Field label="Infertile / dead eggs removed">
          <Input type="number" min={0} max={fertileBefore} value={removed} onChange={(e) => setRemoved(e.target.value)} />
        </Field>
        <p className="text-muted">Fertile kept: <strong>{kept.toLocaleString()}</strong></p>
      </div>
    </Modal>
  );
}

function NumberModal({
  title,
  label,
  max,
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  max: number;
  onClose: () => void;
  onSave: (n: number) => void;
}) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const n = Number(val);
              if (!(n >= 0)) return setErr("Enter a valid number.");
              if (max && n > max) return setErr(`Cannot exceed ${max}.`);
              onSave(n);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label={`${label}${max ? ` (max ${max.toLocaleString()})` : ""}`}>
        <Input type="number" min={0} max={max || undefined} value={val} onChange={(e) => setVal(e.target.value)} />
      </Field>
      {err && <p className="mt-2 text-sm text-status-refunded">{err}</p>}
    </Modal>
  );
}
