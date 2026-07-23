"use client";

import { useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";

import type { BankStatement, Order, Payment } from "@/lib/types";
import { orderTotal } from "@/lib/types";
import { formatRWF } from "@/lib/config";
import { formatDate, formatDateTime, nowISO, todayISO } from "@/lib/format";
import { visibleOrders } from "@/lib/permissions";
import { SearchTimeBar } from "@/components/dashboard/DashKit";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { presetToRange, type PeriodPreset } from "@/lib/period";
import {
  buildStatementRows,
  guessAmountColumn,
  guessRefColumn,
  parseWorkbook,
  type ParsedSheet,
} from "@/lib/excel";
import { runAutoCheck, distinctByAmount, type AutoOutcome } from "@/lib/verification";
import { withHistory } from "@/lib/orders";

interface Staged {
  fileName: string;
  sheet: ParsedSheet;
  refCol: string;
  amtCol: string;
}

/** A checker may enter several transaction ids separated by a dash/space/comma. */
function splitRefs(input: string): string[] {
  return input.split(/[\s,\-]+/).map((s) => s.trim()).filter(Boolean);
}
function lookupRefs(refs: string[], statements: BankStatement[]) {
  const all = statements.flatMap((s) => s.rows);
  const norm = (s: string) => s.trim().toLowerCase();
  // Collapse identical repeats (same ref + amount) so a re-uploaded or
  // overlapping statement doesn't read as a duplicate.
  return refs.map((ref) => ({
    ref,
    matches: distinctByAmount(all.filter((r) => norm(r.ref) === norm(ref))),
  }));
}

/** Verified amount collected on an order vs what is owed. */
function payMatch(o: Order): { tone: "green" | "gold" | "blue"; label: string } {
  const total = orderTotal(o);
  const paid = o.payments.filter((p) => p.verified).reduce((s, p) => s + p.amt, 0);
  if (paid > total) return { tone: "blue", label: `Overpaid +${formatRWF(paid - total)}` };
  if (paid === total) return { tone: "green", label: "Paid in full" };
  if (paid > 0) return { tone: "gold", label: `Short ${formatRWF(total - paid)}` };
  return { tone: "gold", label: `Owes ${formatRWF(total)}` };
}

export default function VerificationPage() {
  const { user } = useAuth();
  const { orders, statements, availability, upsertStatement, removeStatement, upsertOrder, newId } = useData();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // The Accountant is a finance actor here too (upload, auto-check, approve).
  const isAdmin = user?.role === "Admin" || user?.role === "Accountant";

  const [staged, setStaged] = useState<Staged | null>(null);
  const [outcomes, setOutcomes] = useState<AutoOutcome[]>([]);
  const [manual, setManual] = useState<{ order: Order; payIndex: number } | null>(null);

  // Filters for the payments table.
  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const range = presetToRange(preset, custom, todayISO());

  const myOrders = useMemo(
    () => (user ? visibleOrders(orders, user).filter((o) => o.confirmedOk) : []),
    [orders, user]
  );
  const visibleIds = useMemo(() => new Set(myOrders.map((o) => o.id)), [myOrders]);

  // Orders with at least one unverified payment (voided ones don't count).
  const pending = useMemo(
    () => myOrders.filter((o) => o.payments.some((p) => !p.verified && !p.voided)),
    [myOrders]
  );

  // Every payment on confirmed orders — unverified first — so the checker sees
  // both what's left to check and what an admin/checker has already verified.
  const payRows = useMemo(
    () =>
      myOrders
        .filter((o) => o.payments.length > 0)
        .flatMap((o) => o.payments.map((p, i) => ({ o, p, i })))
        .sort((a, b) => Number(!!a.p.verified) - Number(!!b.p.verified) || (a.o.date < b.o.date ? -1 : 1)),
    [myOrders]
  );

  // Payments a checker sent to the Admin (missing/ambiguous transaction ids).
  const approvalRows = useMemo(
    () => myOrders.flatMap((o) => o.payments.map((p, i) => ({ o, p, i })).filter((x) => x.p.pendingApproval && !x.p.verified)),
    [myOrders]
  );

  const payStatus = (p: Payment) => p.voided ? "rejected" : p.verified ? "checked" : p.pendingApproval ? "awaiting" : "unverified";
  const shownPayRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return payRows.filter(({ o, p }) => {
      if (productFilter !== "all" && o.product !== productFilter) return false;
      if (statusFilter !== "all" && payStatus(p) !== statusFilter) return false;
      if (dateFilter && o.date !== dateFilter) return false;
      else if (!dateFilter && (range.from || range.to) && !inRange(o.date, range)) return false;
      if (q && !(o.name.toLowerCase().includes(q) || o.phone.toLowerCase().includes(q) || p.ref.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [payRows, query, productFilter, statusFilter, dateFilter, range]);

  const deliveryDateOptions = useMemo(
    () => [{ value: "", label: "All delivery dates" }, ...availability.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).map((a) => ({ value: a.id, label: formatDate(a.date) }))],
    [availability]
  );

  if (!user) return null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const sheet = await parseWorkbook(file);
      if (sheet.headers.length === 0) {
        toast("That file has no readable rows.", "error");
        return;
      }
      setStaged({
        fileName: file.name,
        sheet,
        refCol: guessRefColumn(sheet.headers),
        amtCol: guessAmountColumn(sheet.headers),
      });
    } catch {
      toast("Could not read that file.", "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function addStatement() {
    if (!staged) return;
    const rows = buildStatementRows(staged.sheet, staged.refCol, staged.amtCol);
    if (rows.length === 0) {
      toast("No rows found with those columns.", "error");
      return;
    }
    const stmt: BankStatement = {
      id: newId("stmt"),
      fileName: staged.fileName,
      uploadedBy: user!.email,
      uploadedOn: nowISO(),
      refColumn: staged.refCol,
      amtColumn: staged.amtCol,
      rows,
    };
    // Single-row write — sending the whole list would delete statements another
    // checker uploaded since this tab loaded.
    void upsertStatement(stmt);
    setStaged(null);

    // Auto-check every unverified payment (including the ones held for Admin
    // approval) against the updated statements — anything that now matches is
    // verified without manual approval. State isn't updated yet, so include the
    // new statement explicitly.
    const res = runAutoCheck(orders, [...statements, stmt], user!, visibleIds);
    const before = new Map(orders.map((o) => [o.id, o]));
    res.orders.filter((o) => before.get(o.id) !== o).forEach((o) => void upsertOrder(o));
    const cleared = res.outcomes.filter((x) => x.result === "verified" || x.result === "corrected").length;
    setOutcomes(res.outcomes);
    toast(
      cleared > 0
        ? `Added "${stmt.fileName}" (${rows.length} rows) — ${cleared} payment(s) auto-verified.`
        : `Added "${stmt.fileName}" (${rows.length} rows).`
    );
  }

  function onRemoveStatement(id: string) {
    void removeStatement(id); // explicit single-row delete
    toast("Statement removed.");
  }

  function runAuto() {
    if (statements.length === 0) {
      toast("Upload at least one bank statement first.", "info");
      return;
    }
    const res = runAutoCheck(orders, statements, user!, visibleIds);
    // Save ONLY the orders the check actually changed. Never re-send the whole
    // collection — that deletes rows this tab hasn't loaded yet.
    const before = new Map(orders.map((o) => [o.id, o]));
    res.orders.filter((o) => before.get(o.id) !== o).forEach((o) => void upsertOrder(o));
    setOutcomes(res.outcomes);
    const verified = res.outcomes.filter((o) => o.result === "verified" || o.result === "corrected").length;
    toast(`Automatic check done — ${verified} verified/corrected, ${res.outcomes.length} checked.`);
  }

  function patchPayment(order: Order, payIndex: number, patch: Partial<Payment>, line: string) {
    const payments = order.payments.map((p, i) => (i === payIndex ? { ...p, ...patch } : p));
    // Single-row write: replacing the whole collection would delete any order
    // created since this tab loaded.
    void upsertOrder(withHistory({ ...order, payments }, user!, line));
  }

  function saveManual(order: Order, payIndex: number, input: string, comment: string) {
    const p0 = order.payments[payIndex];
    const refs = splitRefs(input);
    const on = nowISO();
    const base: Partial<Payment> = { verified: true, verifiedBy: user!.email, verifiedOn: on, comment, flag: undefined, pendingApproval: undefined };

    // Cash / non-bank verifies at the recorded amount.
    if (refs.length === 1 && refs[0].toLowerCase() === "cash") {
      patchPayment(order, payIndex, { ...base, checkedRef: "CASH" }, `Manually verified payment (CASH) — ${comment}`);
      toast("Payment verified (cash).");
      return setManual(null);
    }

    const lookups = lookupRefs(refs, statements);
    const allClean = refs.length > 0 && lookups.every((l) => l.matches.length === 1);

    if (allClean) {
      // Every id was found exactly once — use the amount(s) from the statement.
      const amt = lookups.reduce((s, l) => s + l.matches[0].amt, 0);
      const corrected = amt !== p0.amt;
      const refLabel = refs.join(" + ");
      patchPayment(order, payIndex,
        { ...base, amt, checkedRef: refLabel, flag: corrected ? `Amount set to ${amt.toLocaleString()} from statement` : undefined },
        corrected
          ? `Verified payment (${refLabel}) — amount ${p0.amt.toLocaleString()} → ${amt.toLocaleString()} RWF from statement — ${comment}`
          : `Verified payment (${refLabel}) from statement — ${comment}`);
      toast(corrected ? `Verified — amount set to ${formatRWF(amt)} from the statement.` : `Verified ${formatRWF(amt)} from the statement.`);
      return setManual(null);
    }

    // Missing or ambiguous transaction id → hold for the Admin's final say.
    const missing = lookups.filter((l) => l.matches.length === 0).map((l) => l.ref);
    const dup = lookups.filter((l) => l.matches.length > 1).map((l) => l.ref);
    const flag = missing.length ? `Missing in statements: ${missing.join(", ")}` : `Duplicate ref: ${dup.join(", ")}`;
    patchPayment(order, payIndex,
      { verified: false, pendingApproval: { by: user!.email, on, refs, note: comment }, flag },
      `Payment (${refs.join(", ")}) sent to Admin — ${flag} — ${comment}`);
    toast(`Sent to Admin for approval — ${flag}.`, "info");
    setManual(null);
  }

  // Admin's final say on payments a checker couldn't match to a statement.
  function adminApprove(order: Order, payIndex: number) {
    const p0 = order.payments[payIndex];
    const refs = p0.pendingApproval?.refs ?? [];
    const wasRequested = !!p0.pendingApproval;
    // If it was never sent for approval, fall back to the payment's own ref and
    // note it — either way the payment is verified, and the trigger notifies the
    // verifier that it was verified.
    const ref = refs.join(" + ") || p0.checkedRef || p0.ref;
    patchPayment(order, payIndex,
      {
        verified: true,
        verifiedBy: user!.email,
        verifiedOn: nowISO(),
        checkedRef: ref,
        comment: `Approved by Admin${p0.pendingApproval?.note ? ` — ${p0.pendingApproval.note}` : wasRequested ? "" : " (not requested)"}`,
        flag: undefined,
        pendingApproval: undefined,
      },
      `Admin approved payment (${refs.length ? refs.join(", ") : ref}) — ${formatRWF(p0.amt)}`);
    toast("Payment approved and verified.");
  }
  function adminReject(order: Order, payIndex: number) {
    const p0 = order.payments[payIndex];
    patchPayment(order, payIndex,
      { verified: false, voided: true, pendingApproval: undefined, flag: "Rejected by Admin — not in statements" },
      `Admin rejected payment (${(p0.pendingApproval?.refs ?? []).join(", ")}) — voided, ${formatRWF(p0.amt)} removed from paid`);
    toast("Payment rejected and voided — no longer counts as paid.", "info");
  }

  return (
    <div className="space-y-6">

      {/* Bank statements — uploaded files are visible only to the Admin & Accountant. */}
      {isAdmin && (
      <Card>
        <CardHeader title="Bank statements" />
        {isAdmin ? (
          <>
          <p className="mb-3 text-sm text-ink/60">
            Upload one or more bank statements (Excel/CSV). Clients may pay via
            different banks — all statements are searched together.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFile}
            className="block text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-onyx file:px-4 file:py-2 file:text-white hover:file:brightness-110"
          />

          {staged && (
            <div className="mt-4 rounded-md border border-ink/10 bg-ink/5 p-3">
              <p className="mb-2 text-sm font-medium">
                Map columns for “{staged.fileName}”
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Reference column">
                  <Select
                    value={staged.refCol}
                    onChange={(e) => setStaged({ ...staged, refCol: e.target.value })}
                    options={staged.sheet.headers.map((h) => ({ value: h, label: h }))}
                  />
                </Field>
                <Field label="Amount column">
                  <Select
                    value={staged.amtCol}
                    onChange={(e) => setStaged({ ...staged, amtCol: e.target.value })}
                    options={staged.sheet.headers.map((h) => ({ value: h, label: h }))}
                  />
                </Field>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setStaged(null)}>Cancel</Button>
                <Button onClick={addStatement}>Add statement</Button>
              </div>
            </div>
          )}
          </>
        ) : (
          <p className="mb-1 text-sm text-ink/60">
            Bank statements are uploaded by the Admin — they&apos;re listed below
            so you can verify payments against them.
          </p>
        )}

        <div className="mt-4">
          <TableWrap>
            <thead>
              <tr>
                <Th>File</Th>
                <Th className="text-right">Rows</Th>
                <Th>Uploaded</Th>
                {isAdmin && <Th>Action</Th>}
              </tr>
            </thead>
            <tbody>
              {statements.length === 0 ? (
                <EmptyRow colSpan={isAdmin ? 4 : 3} text="No statements uploaded yet." />
              ) : (
                statements.map((s) => (
                  <tr key={s.id}>
                    <Td>{s.fileName}</Td>
                    <Td className="text-right">{s.rows.length}</Td>
                    <Td>{formatDateTime(s.uploadedOn)}</Td>
                    {isAdmin && (
                      <Td>
                        <Button size="sm" variant="ghost" onClick={() => onRemoveStatement(s.id)}>
                          Remove
                        </Button>
                      </Td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </div>
      </Card>
      )}

      {/* Automatic check */}
      <Card>
        <CardHeader
          title="Automatic check"
          action={<Button onClick={runAuto}>Run automatic check</Button>}
        />
        {outcomes.length === 0 ? (
          <p className="text-sm text-ink/50">
            Run the check to match confirmed payments against the statements.
          </p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>Reference</Th>
                <Th>Result</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o, i) => (
                <tr key={i}>
                  <Td>{o.client}</Td>
                  <Td>{o.ref}</Td>
                  <Td>
                    <Pill
                      tone={
                        o.result === "verified"
                          ? "fulfilled"
                          : o.result === "corrected"
                            ? "gold"
                            : o.result === "duplicate"
                              ? "info"
                              : "refunded"
                      }
                    >
                      {o.result}
                    </Pill>
                  </Td>
                  <Td>{o.detail}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Admin's final say on missing/unmatched transaction ids */}
      {isAdmin && (
        <Card className={approvalRows.length ? "border-gold bg-gold-bg/25" : undefined}>
          <CardHeader title={`Missing-payment approvals (${approvalRows.length})`} />
          <p className="mb-3 text-sm text-ink/60">
            Payments a checker could not match to any bank statement. You have the final say — approve to verify, or reject.
          </p>
          <TableWrap>
            <thead>
              <tr>
                <Th>Client</Th><Th>Product</Th><Th className="text-right">Amount</Th>
                <Th>Transaction id(s)</Th><Th>From checker</Th><Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {approvalRows.length === 0 ? (
                <EmptyRow colSpan={6} text="Nothing awaiting your approval." />
              ) : approvalRows.map(({ o, p, i }) => (
                <tr key={`${o.id}-${i}`}>
                  <Td>{o.name}</Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right">{formatRWF(p.amt)}</Td>
                  <Td>
                    <span className="font-mono text-xs">{(p.pendingApproval?.refs ?? []).join(", ")}</span>
                    <div className="text-xs text-status-refunded">{p.flag}</div>
                    {p.pendingApproval?.note && <div className="text-xs text-muted">“{p.pendingApproval.note}”</div>}
                  </Td>
                  <Td className="text-xs text-muted">{p.pendingApproval?.by}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => adminApprove(o, i)}>Approve</Button>
                      <Button size="sm" variant="ghost" onClick={() => adminReject(o, i)}>Reject</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {/* Payments — awaiting + already checked */}
      <Card>
        <CardHeader title={`Payments (${shownPayRows.length} shown · ${pending.reduce((n, o) => n + o.payments.filter((p) => !p.verified).length, 0)} awaiting)`} />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <SearchTimeBar q={query} setQ={setQuery} placeholder="Search — client, phone, or transaction ID…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />
          </div>
          <div className="w-44">
            <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} options={[
              { value: "all", label: "All products" },
              { value: "Tetra Super Harco", label: "Tetra Super Harco" },
              { value: "Ross 308", label: "Ross 308" },
            ]} />
          </div>
          <div className="w-48">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={[
              { value: "all", label: "All statuses" },
              { value: "unverified", label: "Unverified" },
              { value: "awaiting", label: "Awaiting admin" },
              { value: "checked", label: "Checked ✓" },
              { value: "rejected", label: "Rejected · voided" },
            ]} />
          </div>
          <div className="w-48">
            <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} options={deliveryDateOptions} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Product</Th>
              <Th>Delivery</Th>
              <Th className="text-right">Amount</Th>
              <Th>Reference</Th>
              <Th>Status</Th>
              <Th>Vs owed</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {shownPayRows.length === 0 ? (
              <EmptyRow colSpan={8} text="No payments match these filters." />
            ) : (
              shownPayRows.map(({ o, p, i }) => (
                <tr key={`${o.id}-${i}`} className={p.verified ? "bg-green-bg" : undefined}>
                  <Td>{o.name}</Td>
                  <Td>{o.product}</Td>
                  <Td>{o.date}</Td>
                  <Td className="text-right">{formatRWF(p.amt)}</Td>
                  <Td>
                    {p.ref}
                    {p.flag && <div className="text-xs text-status-refunded">{p.flag}</div>}
                  </Td>
                  <Td>
                    {p.voided ? (
                      <div>
                        <Pill tone="red">Rejected · voided</Pill>
                        <div className="text-xs text-muted">not counted as paid</div>
                      </div>
                    ) : p.verified ? (
                      <div>
                        <Pill tone="fulfilled">Checked ✓</Pill>
                        <div className="text-xs text-muted">by {p.verifiedBy ?? "—"}{p.verifiedOn ? ` · ${formatDateTime(p.verifiedOn)}` : ""}</div>
                      </div>
                    ) : p.pendingApproval ? (
                      <div>
                        <Pill tone="gold">Awaiting admin</Pill>
                        <div className="text-xs text-muted">sent by {p.pendingApproval.by}</div>
                      </div>
                    ) : (
                      <Pill tone="pending">Unverified</Pill>
                    )}
                  </Td>
                  <Td>
                    {(() => { const m = payMatch(o); return <Pill tone={m.tone === "green" ? "fulfilled" : m.tone === "blue" ? "info" : "gold"}>{m.label}</Pill>; })()}
                  </Td>
                  <Td>
                    {p.voided ? (
                      <span className="text-xs text-muted">—</span>
                    ) : p.verified ? (
                      <span className="text-xs text-muted">—</span>
                    ) : p.pendingApproval ? (
                      isAdmin ? (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => adminApprove(o, i)}>Approve</Button>
                          <Button size="sm" variant="ghost" onClick={() => adminReject(o, i)}>Reject</Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">with admin</span>
                      )
                    ) : (
                      <Button size="sm" onClick={() => setManual({ order: o, payIndex: i })}>
                        Verify manually
                      </Button>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>

      {manual && (
        <ManualModal
          order={manual.order}
          payment={manual.order.payments[manual.payIndex]}
          statements={statements}
          onClose={() => setManual(null)}
          onSave={(ref, comment) => saveManual(manual.order, manual.payIndex, ref, comment)}
        />
      )}
    </div>
  );
}

function ManualModal({
  order,
  payment,
  statements,
  onClose,
  onSave,
}: {
  order: Order;
  payment: Payment;
  statements: BankStatement[];
  onClose: () => void;
  onSave: (ref: string, comment: string) => void;
}) {
  const [ref, setRef] = useState(payment.ref);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Live per-id lookup across all uploaded statements.
  const refs = splitRefs(ref);
  const cash = refs.length === 1 && refs[0].toLowerCase() === "cash";
  const lookups = cash ? [] : lookupRefs(refs, statements);
  const allClean = !cash && refs.length > 0 && lookups.every((l) => l.matches.length === 1);
  const bankTotal = allClean ? lookups.reduce((s, l) => s + l.matches[0].amt, 0) : null;
  const anyMissing = !cash && lookups.some((l) => l.matches.length === 0);

  const action: "cash" | "verify" | "admin" = cash ? "cash" : allClean ? "verify" : "admin";
  const btnLabel =
    action === "cash" ? "Confirm (cash)"
    : action === "verify" ? (bankTotal !== payment.amt ? `Verify at ${formatRWF(bankTotal!)}` : "Confirm verification")
    : "Send to Admin for approval";

  return (
    <Modal
      open
      onClose={onClose}
      title={`Verify payment — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!ref.trim()) return setErr("Enter the transaction id(s) or CASH.");
              if (!comment.trim()) return setErr("A comment is required.");
              onSave(ref.trim(), comment.trim());
            }}
          >
            {btnLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink/60">Recorded amount: <strong>{formatRWF(payment.amt)}</strong></p>
        <Field label="Transaction id(s) — two ids separated by a dash, e.g. 291516404175-29165859045 · cash: write CASH">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>

        {!cash && refs.length > 0 && (
          <div className="space-y-1 rounded-lg border border-line bg-cream/40 p-2.5 text-sm">
            {lookups.map((l, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{l.ref}</span>
                {l.matches.length === 1 ? (
                  <span className="shrink-0 text-green">found · {formatRWF(l.matches[0].amt)}</span>
                ) : l.matches.length > 1 ? (
                  <span className="shrink-0 text-gold-dark">appears {l.matches.length}× · review</span>
                ) : (
                  <span className="shrink-0 text-red">not in any statement</span>
                )}
              </div>
            ))}
            {allClean && bankTotal !== null && (
              <div className="flex items-center justify-between border-t border-line pt-1 font-semibold">
                <span>Total from statement</span><span>{formatRWF(bankTotal)}</span>
              </div>
            )}
          </div>
        )}

        {action === "admin" && (
          <div className="rounded-lg border border-gold bg-gold-bg/50 px-3 py-2 text-sm text-gold-dark">
            {anyMissing ? "One or more transaction ids aren’t in any statement." : "A reference is ambiguous."} This can’t be
            confirmed here — it will be <strong>sent to the Admin</strong> for the final decision.
          </div>
        )}
        {action === "verify" && bankTotal !== payment.amt && (
          <div className="rounded-lg border border-gold bg-gold-bg/50 px-3 py-2 text-sm text-gold-dark">
            Recorded <strong>{formatRWF(payment.amt)}</strong> but the statement total is <strong>{formatRWF(bankTotal!)}</strong>.
            On confirm the amount will be set to <strong>{formatRWF(bankTotal!)}</strong>.
          </div>
        )}
        {(action === "verify" || action === "cash") && (() => {
          const amt = action === "verify" ? bankTotal! : payment.amt;
          const otherVerified = order.payments.filter((pp) => pp !== payment && pp.verified).reduce((s, pp) => s + pp.amt, 0);
          const paid = otherVerified + amt;
          const total = orderTotal(order);
          const cls = paid === total ? "text-green" : "text-gold-dark";
          const state = paid > total ? `overpaid by ${formatRWF(paid - total)}` : paid === total ? "paid in full" : `still short ${formatRWF(total - paid)}`;
          return (
            <div className="rounded-lg border border-line bg-cream/40 px-3 py-2 text-sm">
              After this the order will have <strong>{formatRWF(paid)}</strong> of <strong>{formatRWF(total)}</strong> owed — <strong className={cls}>{state}</strong>.
            </div>
          );
        })()}

        <Field label="Comment (required)">
          <Input value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {err && <p className="text-sm text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}
