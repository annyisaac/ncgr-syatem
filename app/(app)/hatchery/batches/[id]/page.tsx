"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { setBatchNo } from "@/lib/hatchery/db";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Select";
import { formatDate, formatDateTime, nowISO } from "@/lib/format";
import { LIFECYCLE_STEPS } from "@/lib/hatchery/types";
import { removedInStage, fertilityPct, flockRemoved, flockFertileAfterC2, flockTransferred, settableEggs } from "@/lib/hatchery/lifecycle";

const CAN_EDIT_CODE = ["Admin", "Hatchery Manager"];

const STEP_DESC: Record<string, string> = {
  reception: "Eggs received from farms and recorded.",
  storage: "Eggs stored before setting.",
  fumigation: "Eggs fumigated before setting.",
  setting: "Eggs set in setter machines.",
  "candling-1": "Remove infertile and early dead embryos.",
  "candling-2": "Remove late dead and abnormal embryos.",
  transfer: "Eggs transferred to hatcher machines.",
  hatching: "Eggs hatch into chicks.",
  counting: "Chicks counted, graded and boxed.",
  vaccination: "Chicks vaccinated.",
  dispatch: "Chicks dispatched to customers.",
  delivery: "Chicks delivered to customer locations.",
};

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const { batches, receptions, patchBatchLocal } = useHatchery();
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
  const totalSet = batch.setters.reduce((s, a) => s + a.eggs, 0);

  function openEdit() { setCode(batch!.batchNo); setErr(null); setEditOpen(true); }
  function copyCode() {
    navigator.clipboard?.writeText(batch!.batchNo).then(() => toast("Batch code copied.")).catch(() => {});
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
      await setBatchNo(batch!.id, next);
      patchBatchLocal({ ...batch!, batchNo: next, history: [...(batch!.history ?? []), `${nowISO()} — Batch code changed ${batch!.batchNo} → ${next} (by ${user!.name})`] });
      toast(`Batch code updated to ${next}.`);
      setEditOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update the batch code.");
    } finally {
      setSaving(false);
    }
  }

  const statusTone = batch.status === "inactive" ? "neutral" : batch.status === "delivered" ? "fulfilled" : batch.status === "dispatched" ? "gold" : "green";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Batch Detail</h1>
        <p className="text-sm text-muted"><Link href="/hatchery/batches" className="text-gold-dark hover:underline">Batches</Link> <span className="text-muted">›</span> {batch.batchNo}</p>
      </div>

      {/* Batch summary */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.09em] text-muted"><IcoDoc />Batch summary</p>
          <div className="flex items-center gap-2">
            <Pill tone={statusTone}>{batch.status}</Pill>
            <Link href="/hatchery/batches" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-gold">← Back to batches</Link>
            {canEditCode && <Button variant="ghost" size="sm" onClick={openEdit}>Edit code</Button>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          <Info label="Batch code" tone="green">
            <span className="inline-flex items-center gap-1.5">{batch.batchNo}
              <button type="button" onClick={copyCode} title="Copy" className="text-muted hover:text-ink"><IcoCopy /></button>
            </span>
          </Info>
          <Info label="Farm">{batch.farm}</Info>
          <Info label="Eggs set" tone="green">{batch.eggsSet.toLocaleString()}</Info>
          <Info label="Hatched">{batch.hatchedCount.toLocaleString()}</Info>
          <Info label="Created on">{formatDateTime(batch.createdAt)}</Info>
          <Info label="Product">{batch.productType}</Info>
          <Info label="Flock">{batch.flockId}</Info>
          <Info label="Fertility" tone="green">{`${fertilityPct(batch).toFixed(0)}%`}</Info>
          <Info label="Saleable">{batch.saleableCount.toLocaleString()}</Info>
          <Info label="Created by"><span className="break-all text-[0.8rem]">{batch.by}</span></Info>
        </div>
      </Card>

      {/* Body: left detail + right lifecycle */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <p className="mb-3 flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.09em] text-muted"><IcoMachine />Setter machines</p>
              <div className="space-y-1.5 text-sm">
                {batch.setters.length === 0 ? <p className="text-muted">—</p> : batch.setters.map((a) => (
                  <div key={a.machineCode} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                    <span className="inline-flex items-center gap-2 font-medium text-ink"><span className="text-blue"><IcoMachine /></span>{a.machineCode}</span>
                    <span className="text-muted">{a.eggs.toLocaleString()} eggs</span>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-lg bg-cream/60 px-3 py-2 font-semibold">
                  <span className="text-ink">Total eggs set</span><span className="text-green">{totalSet.toLocaleString()} eggs</span>
                </div>
              </div>
              {batch.setterMoves && batch.setterMoves.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wide text-muted">Trolley moves</p>
                  <div className="space-y-1 text-xs">
                    {batch.setterMoves.map((m, i) => (
                      <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-1.5">
                        <span><strong className="text-ink">{m.from}</strong> → <strong className="text-ink">{m.to}</strong> · {m.eggs.toLocaleString()} eggs{m.trolleys ? ` (${m.trolleys})` : ""}</span>
                        <span className="text-muted">{formatDateTime(m.on)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
            <Card>
              <p className="mb-3 flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.09em] text-muted"><IcoBox />Hatcher machines (transfer)</p>
              {batch.transfers.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-gold-bg text-gold-dark"><IcoBox /></span>
                  <p className="text-sm text-muted">Not transferred yet.</p>
                </div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  {batch.transfers.map((a) => (
                    <div key={a.machineCode} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                      <span className="inline-flex items-center gap-2 font-medium text-ink"><span className="text-gold-dark"><IcoBox /></span>{a.machineCode}</span>
                      <span className="text-muted">{a.eggs.toLocaleString()} eggs</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {batch.flocks && batch.flocks.length > 0 && (
            <Card>
              <p className="mb-3 text-[0.68rem] font-bold uppercase tracking-[0.09em] text-muted">Flock(s) in this batch ({batch.flocks.length})</p>
              <div className="space-y-2 text-sm">
                {batch.flocks.map((f) => (
                  <div key={f.flockId + f.farm} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="font-medium text-ink">{f.farm} · flock {f.flockId}</span>
                    <span className="text-xs text-muted">Set {f.eggsSet.toLocaleString()} · C1 −{flockRemoved(f, 1).toLocaleString()} · C2 −{flockRemoved(f, 2).toLocaleString()} · Total {flockFertileAfterC2(f).toLocaleString()} · Transferred {flockTransferred(f).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {(batch.receptionIds?.length ?? 0) > 0 && (
            <Card>
              <p className="mb-3 text-[0.68rem] font-bold uppercase tracking-[0.09em] text-muted">Receptions used to create this batch ({batch.receptionIds!.length})</p>
              <div className="space-y-2 text-sm">
                {batch.receptionIds!.map((rid) => {
                  const r = receptions.find((x) => x.id === rid);
                  if (!r) return <div key={rid} className="rounded-lg border border-line px-3 py-2 text-xs text-muted">Reception no longer available</div>;
                  return (
                    <div key={rid} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                      <span className="font-medium text-ink">{r.farm} · flock {r.flockId}</span>
                      <span className="text-xs text-muted">{formatDate(r.date)} · received {r.eggsReceived.toLocaleString()} · settable {settableEggs(r).toLocaleString()} · fumigated {(r.fumigatedEggs ?? 0).toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card>
            <p className="mb-3 text-[0.68rem] font-bold uppercase tracking-[0.09em] text-muted">Candling</p>
            {batch.candlings.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/30 bg-gold-bg/40 px-4 py-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold-bg text-gold-dark"><IcoHourglass /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">No candling yet</p>
                  <p className="text-xs text-muted">Candling I is usually done on day 10 of incubation to remove infertile and early dead embryos.</p>
                </div>
                <Link href="/hatchery/candling"><Button>Start Candling I</Button></Link>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                {batch.candlings.map((c, i) => (
                  <div key={i} className="rounded-lg border border-line px-3 py-2">
                    <div className="flex justify-between"><strong className="text-ink">Candling {c.stage === 1 ? "I" : "II"}</strong><span className="text-muted">{formatDate(c.date)} · {c.by}</span></div>
                    <div className="mt-1 text-xs text-muted">{Object.entries(c.categories).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(" · ") || "none"} — total removed {c.totalRemoved}</div>
                  </div>
                ))}
                <p className="text-xs text-muted">Removed: Candling I = {removedInStage(batch, 1)}, Candling II = {removedInStage(batch, 2)}.</p>
              </div>
            )}
          </Card>
        </div>

        {/* Lifecycle timeline */}
        <div>
          <Card>
            <p className="mb-4 flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.09em] text-muted"><IcoFlow />Lifecycle</p>
            <ol>
              {LIFECYCLE_STEPS.map((s, i) => {
                const mark = batch.steps[s.key];
                const state: "done" | "pending" | "future" = mark ? "done" : nextStep?.key === s.key ? "pending" : "future";
                const last = i === LIFECYCLE_STEPS.length - 1;
                return (
                  <li key={s.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${state === "done" ? "bg-green text-white" : state === "pending" ? "bg-gold text-[#231b04]" : "bg-grey-bg text-muted"}`}>
                        {state === "done" ? <IcoCheck /> : state === "pending" ? <IcoHourglass /> : <IcoLock />}
                      </span>
                      {!last && <span className={`w-px flex-1 ${state === "done" ? "bg-green/40" : "bg-line"}`} />}
                    </div>
                    <div className={`min-w-0 flex-1 pb-5 ${state === "pending" ? "rounded-lg bg-gold-bg/30 px-2 -mx-2" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink">{s.label}</p>
                        {state === "pending" && <Pill tone="gold">Pending</Pill>}
                      </div>
                      <p className="text-xs text-muted">{STEP_DESC[s.key] ?? ""}</p>
                      <p className="mt-0.5 text-[0.7rem] text-muted">
                        {mark ? <>{formatDateTime(mark.on)}<br /><span className="text-muted/80">by {mark.by}</span></> : "—"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>

      {/* Edit code modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit batch code"
        footer={<><Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={saveCode} disabled={saving}>{saving ? "Saving…" : "Save code"}</Button></>}
      >
        <div className="space-y-3">
          <Field label="Batch code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. NCGR-H26-W01-01" /></Field>
          <p className="text-xs text-muted">Only the batch code changes — flocks, counts and history are kept.</p>
          {err && <p className="text-sm text-status-refunded">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}

function Info({ label, children, tone }: { label: string; children: ReactNode; tone?: "green" }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 truncate font-semibold ${tone === "green" ? "text-green" : "text-ink"}`}>{children}</p>
    </div>
  );
}

// ---- icons ----------------------------------------------------------------
const isvg = (children: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoDoc = () => <span className="text-gold-dark">{isvg(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>)}</span>;
const IcoCopy = () => isvg(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>, 14);
const IcoMachine = () => isvg(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8v8H8z" /></>);
const IcoBox = () => isvg(<><path d="M4 8l8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /></>);
const IcoCheck = () => isvg(<path d="M5 12l4 4 10-10" />, 14);
const IcoHourglass = () => isvg(<><path d="M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9" /></>, 14);
const IcoLock = () => isvg(<><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>, 12);
const IcoFlow = () => <span className="text-gold-dark">{isvg(<><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M8 6h4a4 4 0 0 1 4 4M8 18h4a4 4 0 0 0 4-4" /></>)}</span>;
