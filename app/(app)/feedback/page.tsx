"use client";

/**
 * Customer feedback & vet follow-up.
 *
 * A payment checker works a list of DELIVERED customers, grouped by delivery
 * date, and records what each customer said on the follow-up call. If the
 * customer needs veterinary attention it is flagged for the hatchery vet, who
 * picks it up from the follow-up queue and updates it until it is resolved.
 *
 * One feedback record per delivered order (keyed by the order id). The record
 * carries a denormalized snapshot of the customer + delivery, so the vet
 * follows up without any access to the sales orders.
 */

import { useMemo, useState } from "react";
import type { TextareaHTMLAttributes } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td } from "@/components/ui/Table";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, nowISO } from "@/lib/format";
import { visibleOrders } from "@/lib/permissions";
import type {
  CustomerFeedback,
  FeedbackRating,
  Order,
  Role,
  User,
  VetFollowUpStatus,
  VetUpdate,
} from "@/lib/types";

/** Roles that call customers and record their feedback. */
const CAN_RECORD: Role[] = ["Admin", "Tetra Payment Checker", "Ross Payment Checker"];
/** Roles that handle the veterinary follow-up queue. */
const CAN_VET: Role[] = ["Admin", "Hatchery Veterinary"];

const RATING_LABEL: Record<FeedbackRating, string> = {
  satisfied: "Satisfied",
  neutral: "Neutral",
  unsatisfied: "Unsatisfied",
};
const RATING_TONE: Record<FeedbackRating, "green" | "amber" | "red"> = {
  satisfied: "green",
  neutral: "amber",
  unsatisfied: "red",
};
const RATING_ACTIVE: Record<FeedbackRating, string> = {
  satisfied: "border-green bg-green-bg text-green",
  neutral: "border-amber bg-amber-bg text-amber",
  unsatisfied: "border-red bg-red-bg text-red",
};
const VET_LABEL: Record<VetFollowUpStatus, string> = {
  pending: "Awaiting vet",
  in_progress: "Vet following up",
  resolved: "Resolved",
};
const VET_TONE: Record<VetFollowUpStatus, "amber" | "info" | "green"> = {
  pending: "amber",
  in_progress: "info",
  resolved: "green",
};

/** A delivered order is one that was handed over (fulfilled), not refunded. */
function isDelivered(o: Order): boolean {
  return (o.status === "fulfilled" || o.deliverOk === true) && o.status !== "refunded" && o.status !== "rejected";
}

function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-[80px] w-full rounded-[9px] border border-line bg-field px-3.5 py-2.5 text-[0.9rem] text-ink",
        "focus:outline-none focus-visible:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold",
        props.className
      )}
    />
  );
}

export default function FeedbackPage() {
  const { user } = useAuth();
  const { orders, customerFeedback, upsertCustomerFeedback } = useData();

  if (!user) return null;
  const canRecord = CAN_RECORD.includes(user.role);
  const canVet = CAN_VET.includes(user.role);

  return (
    <div className="space-y-5">
      {canRecord && (
        <RecorderSection
          user={user}
          orders={orders}
          feedback={customerFeedback}
          save={upsertCustomerFeedback}
        />
      )}
      {canVet && (
        <VetSection user={user} feedback={customerFeedback} save={upsertCustomerFeedback} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recorder — delivered customers grouped by delivery date
// ---------------------------------------------------------------------------

function RecorderSection({
  user,
  orders,
  feedback,
  save,
}: {
  user: User;
  orders: Order[];
  feedback: CustomerFeedback[];
  save: (f: CustomerFeedback) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Order | null>(null);

  const fbByOrder = useMemo(
    () => new Map(feedback.map((f) => [f.orderId, f])),
    [feedback]
  );

  const delivered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return visibleOrders(orders, user)
      .filter(isDelivered)
      .filter((o) => !term || o.name.toLowerCase().includes(term) || o.phone.includes(term))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));
  }, [orders, user, q]);

  // Group by delivery date (already sorted newest-first above).
  const groups = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of delivered) {
      const arr = m.get(o.date) ?? [];
      arr.push(o);
      m.set(o.date, arr);
    }
    return [...m.entries()];
  }, [delivered]);

  const recorded = delivered.filter((o) => fbByOrder.has(o.id)).length;

  return (
    <Card>
      <CardHeader
        title="Customer feedback — delivered customers"
        action={<span className="text-xs text-muted">{recorded}/{delivered.length} recorded</span>}
      />
      <div className="mb-3">
        <Input
          placeholder="Search customer name or phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted">No delivered customers to follow up yet.</p>
      ) : (
        <div className="space-y-4">
          {groups.map(([date, os]) => (
            <div key={date}>
              <p className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
                Delivered {formatDate(date)} · {os.length}
              </p>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Phone</Th>
                    <Th>Product</Th>
                    <Th className="text-right">Chicks</Th>
                    <Th>Feedback</Th>
                    <Th className="text-right">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {os.map((o) => {
                    const fb = fbByOrder.get(o.id);
                    return (
                      <tr key={o.id}>
                        <Td className="font-medium text-ink">{o.name}</Td>
                        <Td>{o.phone}</Td>
                        <Td>{o.product}</Td>
                        <Td className="text-right">{(o.delivered ?? o.chicks).toLocaleString()}</Td>
                        <Td><StatusPill fb={fb} /></Td>
                        <Td className="text-right">
                          <Button size="sm" variant={fb ? "ghost" : "primary"} onClick={() => setEdit(o)}>
                            {fb ? "Edit" : "Record"}
                          </Button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <RecordModal
          order={edit}
          existing={fbByOrder.get(edit.id)}
          user={user}
          onClose={() => setEdit(null)}
          save={save}
        />
      )}
    </Card>
  );
}

function StatusPill({ fb }: { fb?: CustomerFeedback }) {
  if (!fb) return <Pill tone="neutral">Not called</Pill>;
  if (fb.needsVet) {
    const s = fb.vetStatus ?? "pending";
    return <Pill tone={VET_TONE[s]}>{VET_LABEL[s]}</Pill>;
  }
  if (fb.rating) return <Pill tone={RATING_TONE[fb.rating]}>{RATING_LABEL[fb.rating]}</Pill>;
  return <Pill tone="green">Recorded</Pill>;
}

function RecordModal({
  order,
  existing,
  user,
  onClose,
  save,
}: {
  order: Order;
  existing?: CustomerFeedback;
  user: User;
  onClose: () => void;
  save: (f: CustomerFeedback) => Promise<void>;
}) {
  const { toast } = useToast();
  const [rating, setRating] = useState<FeedbackRating | "">(existing?.rating ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [needsVet, setNeedsVet] = useState(existing?.needsVet ?? false);
  const [vetReason, setVetReason] = useState(existing?.vetReason ?? "");
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    const n = note.trim();
    if (!n) return setErr("Enter what the customer said on the call.");
    if (needsVet && !vetReason.trim()) return setErr("Say what the customer needs the vet for.");
    const fb: CustomerFeedback = {
      id: order.id,
      orderId: order.id,
      customerName: order.name,
      phone: order.phone,
      product: order.product,
      deliveryDate: order.date,
      chicks: order.delivered ?? order.chicks,
      district: order.clientDistrict ?? order.district,
      sector: order.clientSector ?? order.sector,
      dsr: order.dsr,
      note: n,
      rating: rating || undefined,
      by: user.email,
      byName: user.name,
      on: nowISO(),
      needsVet,
      vetReason: needsVet ? vetReason.trim() : undefined,
      vetStatus: needsVet ? existing?.vetStatus ?? "pending" : undefined,
      vetUpdates: existing?.vetUpdates ?? [],
      history: [
        ...(existing?.history ?? []),
        `${nowISO()} — Feedback ${existing ? "updated" : "recorded"} by ${user.name}${needsVet ? " · flagged for vet" : ""}`,
      ],
    };
    // Optimistic: the list updates instantly; persist in the background so the
    // dialog closes without waiting on the round trip to the database.
    save(fb).catch(() => toast("Could not save the feedback — check your connection.", "error"));
    toast(needsVet ? "Feedback saved and flagged for the vet." : "Feedback saved.");
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Feedback — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Save feedback</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted">
          {order.product} · delivered {formatDate(order.date)} · {(order.delivered ?? order.chicks).toLocaleString()} chicks · {order.phone}
        </p>
        <Field label="How was the customer?">
          <div className="flex flex-wrap gap-2">
            {(["satisfied", "neutral", "unsatisfied"] as FeedbackRating[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRating(rating === r ? "" : r)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-bold transition",
                  rating === r ? RATING_ACTIVE[r] : "border-line text-muted hover:border-ink"
                )}
              >
                {RATING_LABEL[r]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Customer feedback" required>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What the customer told you on the call…"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={needsVet}
            onChange={(e) => setNeedsVet(e.target.checked)}
            className="h-4 w-4 accent-gold"
          />
          Customer needs veterinary attention
        </label>
        {needsVet && (
          <Field label="What do they need the vet for?" required>
            <Textarea
              value={vetReason}
              onChange={(e) => setVetReason(e.target.value)}
              placeholder="Symptoms or issue the customer described…"
            />
          </Field>
        )}
        {err && <p className="text-sm text-red">{err}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Vet follow-up queue
// ---------------------------------------------------------------------------

function VetSection({
  user,
  feedback,
  save,
}: {
  user: User;
  feedback: CustomerFeedback[];
  save: (f: CustomerFeedback) => Promise<void>;
}) {
  const [act, setAct] = useState<CustomerFeedback | null>(null);

  const queue = useMemo(() => {
    const rank: Record<VetFollowUpStatus, number> = { pending: 0, in_progress: 1, resolved: 2 };
    return feedback
      .filter((f) => f.needsVet)
      .slice()
      .sort(
        (a, b) =>
          rank[a.vetStatus ?? "pending"] - rank[b.vetStatus ?? "pending"] ||
          (a.deliveryDate < b.deliveryDate ? 1 : -1)
      );
  }, [feedback]);

  const open = queue.filter((f) => (f.vetStatus ?? "pending") !== "resolved").length;

  return (
    <Card>
      <CardHeader
        title="Vet follow-up"
        action={<span className="text-xs text-muted">{open} open · {queue.length} total</span>}
      />
      {queue.length === 0 ? (
        <p className="text-sm text-muted">No customers flagged for veterinary attention.</p>
      ) : (
        <div className="space-y-3">
          {queue.map((f) => {
            const status = f.vetStatus ?? "pending";
            return (
              <div key={f.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">
                      {f.customerName} <span className="font-normal text-muted">· {f.phone}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {f.product} · delivered {formatDate(f.deliveryDate)} · {f.chicks.toLocaleString()} chicks
                      {f.district ? ` · ${f.district}` : ""}
                    </p>
                  </div>
                  <Pill tone={VET_TONE[status]}>{VET_LABEL[status]}</Pill>
                </div>
                {f.vetReason && (
                  <p className="mt-2 text-sm"><span className="text-muted">Needs vet for: </span>{f.vetReason}</p>
                )}
                <p className="mt-1 text-sm"><span className="text-muted">Customer feedback: </span>{f.note}</p>
                {f.vetUpdates && f.vetUpdates.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-line pt-2">
                    {f.vetUpdates.map((u, i) => (
                      <div key={i} className="text-xs text-muted">
                        <span className="font-semibold text-ink">{VET_LABEL[u.status]}</span> — {u.note}
                        <span className="opacity-70"> · {u.byName ?? u.by} · {formatDateTime(u.on)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant={status === "resolved" ? "ghost" : "primary"} onClick={() => setAct(f)}>
                    {status === "resolved" ? "Add note" : status === "pending" ? "Start follow-up" : "Update follow-up"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {act && <VetModal fb={act} user={user} onClose={() => setAct(null)} save={save} />}
    </Card>
  );
}

function VetModal({
  fb,
  user,
  onClose,
  save,
}: {
  fb: CustomerFeedback;
  user: User;
  onClose: () => void;
  save: (f: CustomerFeedback) => Promise<void>;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<VetFollowUpStatus>(
    fb.vetStatus === "resolved" ? "resolved" : "in_progress"
  );
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    const n = note.trim();
    if (!n) return setErr("Add a note on what you found, advised, or did.");
    const upd: VetUpdate = { note: n, by: user.email, byName: user.name, on: nowISO(), status };
    // Optimistic: reflect in the queue at once, persist in the background.
    save({
      ...fb,
      vetStatus: status,
      vetUpdates: [...(fb.vetUpdates ?? []), upd],
      history: [
        ...(fb.history ?? []),
        `${nowISO()} — Vet ${status === "resolved" ? "resolved the follow-up" : "updated the follow-up"} (${user.name})`,
      ],
    }).catch(() => toast("Could not save the update — check your connection.", "error"));
    toast(status === "resolved" ? "Follow-up resolved." : "Follow-up updated.");
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Follow-up — ${fb.customerName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Save update</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted">
          {fb.product} · delivered {formatDate(fb.deliveryDate)} · {fb.phone}
        </p>
        {fb.vetReason && (
          <p className="text-sm"><span className="text-muted">Needs vet for: </span>{fb.vetReason}</p>
        )}
        <Field label="Status">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as VetFollowUpStatus)}
            options={[
              { value: "in_progress", label: "Following up" },
              { value: "resolved", label: "Resolved" },
            ]}
          />
        </Field>
        <Field label="Update note" required>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What you found, advised, or did for the customer…"
          />
        </Field>
        {err && <p className="text-sm text-red">{err}</p>}
      </div>
    </Modal>
  );
}
