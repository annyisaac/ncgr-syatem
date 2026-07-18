"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, nowISO } from "@/lib/format";
import { LIFECYCLE_STEPS } from "@/lib/hatchery/types";
import { removedInStage, fertilityPct, hatchabilityPct, flockRemoved, flockFertileAfterC2, flockTransferred } from "@/lib/hatchery/lifecycle";

const CAN_EDIT_CODE = ["Admin", "Hatchery Manager"];

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const { batches, upsertBatch } = useHatchery();
  const { toast } = useToast();
  const batch = batches.find((b) => b.id === params.id);

  const [editOpen, setEditOpen] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canEditCode = !!user && CAN_EDIT_CODE.includes(user.role);

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

  function openEdit() {
    setCode(batch!.batchNo);
    setErr(null);
    setEditOpen(true);
  }

  async function saveCode() {
    setErr(null);
    const next = code.trim();
    if (!next) return setErr("Enter a batch code.");
    if (next === batch!.batchNo) return setEditOpen(false);
    if (batches.some((b) => b.id !== batch!.id && b.batchNo.toLowerCase() === next.toLowerCase()))
      return setErr(`Batch code “${next}” is already used by another batch.`);
    setSaving(true);
    try {
      await upsertBatch({
        ...batch!,
        batchNo: next,
        history: [...(batch!.history ?? []), `${nowISO()} — Batch code changed ${batch!.batchNo} → ${next} (by ${user!.name})`],
      });
      toast(`Batch code updated to ${next}.`);
      setEditOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/hatchery/batches" className="text-sm text-gold-dark underline">← Back to batches</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {canEditCode && <Button variant="ghost" size="sm" onClick={openEdit}>Edit code</Button>}
        </div>
        <Pill tone={batch.status === "inactive" ? "neutral" : batch.status === "delivered" ? "fulfilled" : batch.status === "dispatched" ? "gold" : "info"}>{batch.status}</Pill>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit batch code"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveCode} disabled={saving}>{saving ? "Saving…" : "Save code"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Batch code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. NCGR-H26-W01-01" />
          </Field>
          <p className="text-xs text-muted">Only the batch code changes — flocks, counts and history are kept.</p>
          {err && <p className="text-sm text-status-refunded">{err}</p>}
        </div>
      </Modal>

      <Card>
        <CardHeader title="Batch" />
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Info label="Product" value={batch.productType} />
          <Info label="Farm" value={batch.farm} />
          <Info label="Flock" value={batch.flockId} />
          <Info label="Eggs set" value={batch.eggsSet.toLocaleString()} />
          <Info label="Fertility" value={`${fertilityPct(batch).toFixed(0)}%`} />
          <Info label="Hatchability" value={`${hatchabilityPct(batch).toFixed(0)}%`} />
          <Info label="Hatched" value={batch.hatchedCount.toLocaleString()} />
          <Info label="Saleable" value={batch.saleableCount.toLocaleString()} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Setter machines" />
          <div className="space-y-1 text-sm">
            {batch.setters.length === 0 ? <p className="text-muted">—</p> : batch.setters.map((a) => (
              <div key={a.machineCode} className="flex justify-between rounded-md border border-line px-3 py-1.5"><span>{a.machineCode}</span><span>{a.eggs.toLocaleString()} eggs</span></div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Hatcher machines (transfer)" />
          <div className="space-y-1 text-sm">
            {batch.transfers.length === 0 ? <p className="text-muted">Not transferred yet.</p> : batch.transfers.map((a) => (
              <div key={a.machineCode} className="flex justify-between rounded-md border border-line px-3 py-1.5"><span>{a.machineCode}</span><span>{a.eggs.toLocaleString()} eggs</span></div>
            ))}
          </div>
        </Card>
      </div>

      {batch.flocks && batch.flocks.length > 0 && (
        <Card>
          <CardHeader title={`Flocks in this batch (${batch.flocks.length})`} />
          <div className="space-y-2 text-sm">
            {batch.flocks.map((f) => (
              <div key={f.flockId + f.farm} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                <span className="font-medium">{f.farm} · flock {f.flockId}</span>
                <span className="text-xs text-muted">
                  set {f.eggsSet.toLocaleString()} · C1 −{flockRemoved(f, 1).toLocaleString()} · C2 −{flockRemoved(f, 2).toLocaleString()} · fertile {flockFertileAfterC2(f).toLocaleString()} · transferred {flockTransferred(f).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Candling" />
        {batch.candlings.length === 0 ? <p className="text-sm text-muted">No candling yet.</p> : (
          <div className="space-y-2 text-sm">
            {batch.candlings.map((c, i) => (
              <div key={i} className="rounded-md border border-line px-3 py-2">
                <div className="flex justify-between"><strong>Candling {c.stage === 1 ? "I" : "II"}</strong><span className="text-muted">{formatDate(c.date)} · {c.by}</span></div>
                <div className="mt-1 text-xs text-muted">
                  {Object.entries(c.categories).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(" · ") || "none"} — total removed {c.totalRemoved}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted">Removed: candling I = {removedInStage(batch, 1)}, candling II = {removedInStage(batch, 2)}.</p>
          </div>
        )}
      </Card>

      {batch.hatchedCount > 0 && (
        <Card>
          <CardHeader title="Hatch result" />
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Info label="Hatched" value={batch.hatchedCount.toLocaleString()} />
            <Info label="Culls" value={batch.culls.toLocaleString()} />
            <Info label="Unhatched" value={batch.unhatchedCount.toLocaleString()} />
            <Info label="Saleable" value={batch.saleableCount.toLocaleString()} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Lifecycle" />
        <ol className="space-y-1.5">
          {LIFECYCLE_STEPS.map((s) => {
            const mark = batch.steps[s.key];
            const isNext = nextStep?.key === s.key;
            return (
              <li key={s.key} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
                mark ? "border-green/30 bg-green-bg" : isNext ? "border-gold bg-gold-bg" : "border-line")}>
                <span className="font-medium">{mark ? "✓ " : isNext ? "→ " : ""}{s.label}</span>
                {mark && <span className="text-xs text-muted">{formatDateTime(mark.on)} · {mark.by}</span>}
              </li>
            );
          })}
        </ol>
      </Card>
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
