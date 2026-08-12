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
import { visibleOrders, productForRole, dateHasProduct } from "@/lib/permissions";
import { smartMatch, suggest } from "@/lib/search";
import { paymentSlipUrl } from "@/lib/db";
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
import {
  runAutoCheck,
  distinctByAmount,
  normRef,
  type AutoOutcome,
} from "@/lib/verification";
import { verificationPDF, verificationExcel, type ReconReportRow } from "@/lib/reports";
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
  // Collapse identical repeats (same ref + amount) so a re-uploaded or
  // overlapping statement doesn't read as a duplicate. `normRef` keeps this in
  // step with the automatic check (spacing / padding tolerated).
  return refs.map((ref) => ({
    ref,
    matches: distinctByAmount(all.filter((r) => normRef(r.ref) === normRef(ref))),
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
  const { orders, statements, availability, upsertStatement, removeStatement, upsertOrder, newId, reload } = useData();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // The Accountant is a finance actor here too (upload, auto-check, approve).
  const isAdmin = user?.role === "Admin" || user?.role === "Accountant";

  const [staged, setStaged] = useState<Staged | null>(null);
  const [outcomes, setOutcomes] = useState<AutoOutcome[]>([]);
  const [manual, setManual] = useState<{ order: Order; payIndex: number } | null>(null);
  const [approveFor, setApproveFor] = useState<{ order: Order; payIndex: number } | null>(null);

  // Bulk admin approval — selected pending payments + a shared comment.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");

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

  // Transaction references that appear on more than one visible order — a
  // "doubled" payment. A checker can reject these on the spot (no Admin needed);
  // voiding notifies the Admin automatically.
  const doubledRefs = useMemo(() => {
    const all = user ? visibleOrders(orders, user) : [];
    const byRef = new Map<string, Set<string>>();
    for (const o of all) {
      if (o.status === "rejected" || o.status === "refunded") continue;
      for (const p of o.payments) {
        if (p.voided) continue;
        const r = normRef(p.ref);
        if (!r || r.length < 8 || r === "imported") continue;
        let s = byRef.get(r);
        if (!s) { s = new Set(); byRef.set(r, s); }
        s.add(o.id);
      }
    }
    const out = new Set<string>();
    for (const [r, s] of byRef) if (s.size > 1) out.add(r);
    return out;
  }, [orders, user]);
  const isDoubled = (p: Payment) => !p.voided && doubledRefs.has(normRef(p.ref));

  const payStatus = (p: Payment) => p.voided ? "rejected" : p.verified ? "checked" : p.pendingApproval ? "awaiting" : p.returnedForFix ? "returned" : "unverified";
  const shownPayRows = useMemo(() => {
    return payRows.filter(({ o, p }) => {
      if (productFilter !== "all" && o.product !== productFilter) return false;
      if (statusFilter !== "all" && payStatus(p) !== statusFilter) return false;
      if (dateFilter && o.date !== dateFilter) return false;
      else if (!dateFilter && (range.from || range.to) && !inRange(o.date, range)) return false;
      if (query.trim() && !smartMatch(query, o.name, o.phone, p.ref)) return false;
      return true;
    });
  }, [payRows, query, productFilter, statusFilter, dateFilter, range]);

  const searchSuggestions = useMemo(() => suggest(query, payRows, ({ o }) => o.name, 6), [query, payRows]);

  // Scoped to the checker's product — a Ross checker sees only Ross delivery
  // dates, a Tetra checker only Tetra (Admin / Accountant see all).
  const deliveryDateOptions = useMemo(
    () => {
      const prod = user ? productForRole(user.role) : undefined;
      return [
        { value: "", label: "All delivery dates" },
        ...availability
          .slice()
          .filter((a) => dateHasProduct(a, prod))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((a) => ({ value: a.id, label: formatDate(a.date) })),
      ];
    },
    [availability, user]
  );

  // Reconciliation report over exactly what the payments filter shows.
  const recon = useMemo(() => {
    const label: Record<string, string> = {
      checked: "Verified",
      awaiting: "Awaiting admin",
      returned: "Returned to seller",
      rejected: "Rejected (voided)",
      unverified: "Unverified",
    };
    const rows: ReconReportRow[] = shownPayRows.map(({ o, p }) => ({
      date: o.date,
      client: o.name,
      product: o.product,
      amount: p.amt,
      ref: p.checkedRef || p.ref,
      status: label[payStatus(p)] ?? payStatus(p),
      verifiedBy: p.verifiedBy,
      flag: p.flag,
    }));
    let verified = 0, awaiting = 0, returned = 0, rejected = 0, unverified = 0, verifiedAmount = 0;
    for (const { p } of shownPayRows) {
      const s = payStatus(p);
      if (s === "checked") { verified++; verifiedAmount += p.amt; }
      else if (s === "awaiting") awaiting++;
      else if (s === "returned") returned++;
      else if (s === "rejected") rejected++;
      else unverified++;
    }
    const parts: string[] = [];
    if (productFilter !== "all") parts.push(productFilter);
    if (statusFilter !== "all") parts.push(label[statusFilter] ?? statusFilter);
    if (dateFilter) parts.push(deliveryDateOptions.find((o) => o.value === dateFilter)?.label ?? dateFilter);
    else if (preset !== "all") parts.push(preset);
    if (query.trim()) parts.push(`“${query.trim()}”`);
    return {
      rows,
      summary: { total: rows.length, verified, awaiting, returned, rejected, unverified, verifiedAmount },
      filterLabel: parts.length ? parts.join(" · ") : "All payments",
    };
  }, [shownPayRows, productFilter, statusFilter, dateFilter, preset, query, deliveryDateOptions]);

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

  async function openSlip(path: string) {
    const url = await paymentSlipUrl(path);
    if (url) window.open(url, "_blank", "noopener");
    else toast("Could not open the slip.", "error");
  }

  async function patchPayment(order: Order, payIndex: number, patch: Partial<Payment>, line: string): Promise<boolean> {
    const payments = order.payments.map((p, i) => (i === payIndex ? { ...p, ...patch } : p));
    // Single-row write: replacing the whole collection would delete any order
    // created since this tab loaded.
    try {
      await upsertOrder(withHistory({ ...order, payments }, user!, line));
      return true;
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      if (m.includes("DUPLICATE_PAYMENT_REF")) {
        const ref = m.split("DUPLICATE_PAYMENT_REF:")[1]?.trim();
        toast(`That transaction reference${ref ? ` (${ref})` : ""} has already been used on another order — it can't be used again.`, "error");
      } else {
        toast("Could not save — please try again.", "error");
      }
      void reload();
      return false;
    }
  }

  // `choice` is the checker's decision from the modal when an id isn't found:
  // "seller" hands it back to be corrected, "admin" escalates for approval.
  // "auto" is the normal statement-based outcome (verify / cash / duplicate).
  async function saveManual(order: Order, payIndex: number, input: string, comment: string, choice: "auto" | "admin" | "seller" = "auto") {
    const p0 = order.payments[payIndex];
    const refs = splitRefs(input);
    const on = nowISO();
    const base: Partial<Payment> = { verified: true, verifiedBy: user!.email, verifiedOn: on, comment, flag: undefined, pendingApproval: undefined, returnedForFix: undefined };

    if (choice === "seller") {
      void patchPayment(order, payIndex,
        { verified: false, pendingApproval: undefined, returnedForFix: { by: user!.email, on, refs, note: comment }, flag: `Missing in statements: ${refs.join(", ")}` },
        `Payment (${refs.join(", ")}) returned to the seller to correct the transaction id — ${comment}`);
      toast("Returned to the seller to correct the transaction id.", "info");
      return setManual(null);
    }
    if (choice === "admin") {
      void patchPayment(order, payIndex,
        { verified: false, returnedForFix: undefined, pendingApproval: { by: user!.email, on, refs, note: comment }, flag: `Missing in statements: ${refs.join(", ")}` },
        `Payment (${refs.join(", ")}) sent to the Admin / Accountant for approval — ${comment}`);
      toast("Sent to the Admin / Accountant for approval.", "info");
      return setManual(null);
    }

    // Cash / non-bank verifies at the recorded amount.
    if (refs.length === 1 && refs[0].toLowerCase() === "cash") {
      void patchPayment(order, payIndex, { ...base, checkedRef: "CASH" }, `Manually verified payment (CASH) — ${comment}`);
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
      // A used transaction id can't be reused — the DB rejects it; keep the
      // modal open so the checker can enter the correct id.
      const ok = await patchPayment(order, payIndex,
        { ...base, amt, checkedRef: refLabel, flag: corrected ? `Amount set to ${amt.toLocaleString()} from statement` : undefined },
        corrected
          ? `Verified payment (${refLabel}) — amount ${p0.amt.toLocaleString()} → ${amt.toLocaleString()} RWF from statement — ${comment}`
          : `Verified payment (${refLabel}) from statement — ${comment}`);
      if (!ok) return;
      toast(corrected ? `Verified — amount set to ${formatRWF(amt)} from the statement.` : `Verified ${formatRWF(amt)} from the statement.`);
      return setManual(null);
    }

    const missing = lookups.filter((l) => l.matches.length === 0).map((l) => l.ref);
    const dup = lookups.filter((l) => l.matches.length > 1).map((l) => l.ref);

    // A duplicate id (found with different amounts) is ambiguous, not a typo, so
    // it goes straight to the Admin.
    if (dup.length) {
      const flag = `Duplicate ref: ${dup.join(", ")}`;
      void patchPayment(order, payIndex,
        { verified: false, pendingApproval: { by: user!.email, on, refs, note: comment }, returnedForFix: undefined, flag },
        `Payment (${refs.join(", ")}) sent to Admin — ${flag} — ${comment}`);
      toast(`Sent to Admin for approval — ${flag}.`, "info");
      return setManual(null);
    }

    // Fallback: a missing id with no explicit choice escalates to the Admin.
    const flag = `Missing in statements: ${missing.join(", ")}`;
    void patchPayment(order, payIndex,
      { verified: false, pendingApproval: { by: user!.email, on, refs, note: comment }, returnedForFix: undefined, flag },
      `Payment (${refs.join(", ")}) sent to Admin — ${flag} — ${comment}`);
    toast(`Sent to Admin for approval — ${flag}.`, "info");
    setManual(null);
  }

  // Admin's final say on payments a checker couldn't match to a statement.
  // A comment (why it's being approved) is required.
  async function adminApprove(order: Order, payIndex: number, note: string) {
    const p0 = order.payments[payIndex];
    const refs = p0.pendingApproval?.refs ?? [];
    // If it was never sent for approval, fall back to the payment's own ref and
    // note it — either way the payment is verified, and the trigger notifies the
    // verifier that it was verified.
    const ref = refs.join(" + ") || p0.checkedRef || p0.ref;
    const ok = await patchPayment(order, payIndex,
      {
        verified: true,
        verifiedBy: user!.email,
        verifiedOn: nowISO(),
        checkedRef: ref,
        comment: `Approved by Admin — ${note}`,
        flag: undefined,
        pendingApproval: undefined,
        reusedDispute: undefined, // dispute resolved once the Admin approves
      },
      `Admin approved payment (${refs.length ? refs.join(", ") : ref}) — ${formatRWF(p0.amt)} — ${note}`);
    if (!ok) return;
    toast("Payment approved and verified.");
    setApproveFor(null);
  }
  function adminReject(order: Order, payIndex: number) {
    const p0 = order.payments[payIndex];
    void patchPayment(order, payIndex,
      { verified: false, voided: true, pendingApproval: undefined, flag: "Rejected by Admin — not in statements" },
      `Admin rejected payment (${(p0.pendingApproval?.refs ?? []).join(", ")}) — voided, ${formatRWF(p0.amt)} removed from paid`);
    toast("Payment rejected and voided — no longer counts as paid.", "info");
  }

  // Any checker (or the Admin) can reject a DOUBLED payment on the spot — no
  // Admin approval needed. Voiding it fires the "Payment rejected" notification,
  // which reaches every Admin (they're always in the order audience).
  async function rejectDuplicate(order: Order, payIndex: number) {
    const p0 = order.payments[payIndex];
    if (typeof window !== "undefined" && !window.confirm(
      `Reject this DUPLICATE payment?\n\n${order.name} · ${formatRWF(p0.amt)} · ref ${p0.ref}\n\nThe payment is voided (stops counting as paid) and the Admin is notified.`
    )) return;
    const ok = await patchPayment(order, payIndex,
      { verified: false, voided: true, verifiedBy: undefined, verifiedOn: undefined, pendingApproval: undefined, returnedForFix: undefined, flag: `Rejected as duplicate by ${user!.name}` },
      `Payment (${p0.ref}) rejected as a DUPLICATE reference by ${user!.name} — ${formatRWF(p0.amt)} voided`);
    if (ok) toast("Duplicate payment rejected — the Admin has been notified.");
  }

  // --- Bulk admin actions -------------------------------------------------
  const selKey = (oid: string, i: number) => `${oid}::${i}`;
  const toggleSel = (oid: string, i: number) =>
    setSel((prev) => {
      const n = new Set(prev);
      const k = selKey(oid, i);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  const allSelected = approvalRows.length > 0 && approvalRows.every((x) => sel.has(selKey(x.o.id, x.i)));
  const toggleSelAll = () =>
    setSel(allSelected ? new Set() : new Set(approvalRows.map((x) => selKey(x.o.id, x.i))));

  /** Group the selection by order so multiple payments on one order are written
   *  in a single update (never overwrite one patch with the next). */
  function groupSelection(): Map<string, number[]> {
    const groups = new Map<string, number[]>();
    for (const k of sel) {
      const [oid, iStr] = k.split("::");
      const arr = groups.get(oid) ?? [];
      arr.push(Number(iStr));
      groups.set(oid, arr);
    }
    return groups;
  }

  function bulkApprove() {
    const note = bulkNote.trim();
    if (!note) return toast("Add an approval comment for the selected payments.", "error");
    let count = 0;
    for (const [oid, idxs] of groupSelection()) {
      const order = myOrders.find((o) => o.id === oid);
      if (!order) continue;
      let updated = order;
      for (const i of idxs) {
        const p0 = order.payments[i];
        if (!p0 || p0.verified || p0.voided) continue;
        const refs = p0.pendingApproval?.refs ?? [];
        const ref = refs.join(" + ") || p0.checkedRef || p0.ref;
        const payments = updated.payments.map((p, idx) =>
          idx === i
            ? { ...p, verified: true, verifiedBy: user!.email, verifiedOn: nowISO(), checkedRef: ref, comment: `Approved by Admin — ${note}`, flag: undefined, pendingApproval: undefined }
            : p
        );
        updated = withHistory({ ...updated, payments }, user!, `Admin approved payment (${refs.length ? refs.join(", ") : ref}) — ${formatRWF(p0.amt)} — ${note}`);
        count++;
      }
      if (updated !== order) void upsertOrder(updated);
    }
    setSel(new Set());
    setBulkNote("");
    toast(count ? `${count} payment(s) approved.` : "Nothing to approve.", count ? "success" : "info");
  }

  function bulkReject() {
    let count = 0;
    for (const [oid, idxs] of groupSelection()) {
      const order = myOrders.find((o) => o.id === oid);
      if (!order) continue;
      let updated = order;
      for (const i of idxs) {
        const p0 = order.payments[i];
        if (!p0 || p0.verified || p0.voided) continue;
        const payments = updated.payments.map((p, idx) =>
          idx === i
            ? { ...p, verified: false, voided: true, pendingApproval: undefined, flag: "Rejected by Admin — not in statements" }
            : p
        );
        updated = withHistory({ ...updated, payments }, user!, `Admin rejected payment (${(p0.pendingApproval?.refs ?? []).join(", ")}) — voided, ${formatRWF(p0.amt)} removed from paid`);
        count++;
      }
      if (updated !== order) void upsertOrder(updated);
    }
    setSel(new Set());
    toast(count ? `${count} payment(s) rejected and voided.` : "Nothing to reject.", "info");
  }

  return (
    <div className="space-y-6">

      {/* How a not-in-statement id is handled — shown to checkers and the Admin. */}
      <Card>
        <CardHeader title="When a transaction ID isn't in the statement" />
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink/70">
          <li>Verify a payment by matching its ID to the statement — automatically, or with <strong>Verify manually</strong> (the amount shows when the ID is found).</li>
          <li>If the ID <strong>isn&apos;t found</strong>, in the Verify-manually box choose either <strong>Return to seller to fix</strong> (the seller / zone manager / accountant corrects the ID) or <strong>Send to Admin</strong> for approval.</li>
          <li>When returned, they fix the ID and it comes back here to <strong>re-verify</strong> (or run the auto-check).</li>
          <li>If the Admin / Accountant also can&apos;t find it, they <strong>reject the payment</strong> below — that voids the <em>payment only</em> (it stops counting as paid); the order stays open.</li>
          <li>A <strong>duplicate</strong> ID (appears with different amounts) is ambiguous, not a typo, so it goes straight to the Admin.</li>
        </ol>
      </Card>

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
                          : o.result === "corrected" || o.result === "review"
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
            Payments a checker could not match to any bank statement. You have the final say — <strong>approve</strong> to
            verify it, or <strong>reject</strong> if you also can&apos;t find it. Rejecting voids the <em>payment only</em> (it
            stops counting toward paid/balance); the order itself stays open.
          </p>
          {approvalRows.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-cream/40 p-2.5">
              <span className="text-sm text-ink/70">{sel.size} selected</span>
              <div className="min-w-[220px] flex-1">
                <Input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder="Approval comment (applies to all selected)…" />
              </div>
              <Button size="sm" disabled={sel.size === 0} onClick={bulkApprove}>Approve selected</Button>
              <Button size="sm" variant="ghost" disabled={sel.size === 0} onClick={bulkReject}>Reject selected</Button>
            </div>
          )}
          <TableWrap>
            <thead>
              <tr>
                <Th><input type="checkbox" checked={allSelected} onChange={toggleSelAll} className="h-4 w-4 accent-gold" aria-label="Select all" /></Th>
                <Th>Client</Th><Th>Product</Th><Th className="text-right">Amount</Th>
                <Th>Transaction id(s)</Th><Th>From checker</Th><Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {approvalRows.length === 0 ? (
                <EmptyRow colSpan={7} text="Nothing awaiting your approval." />
              ) : approvalRows.map(({ o, p, i }) => (
                <tr key={`${o.id}-${i}`}>
                  <Td><input type="checkbox" checked={sel.has(selKey(o.id, i))} onChange={() => toggleSel(o.id, i)} className="h-4 w-4 accent-gold" aria-label={`Select ${o.name}`} /></Td>
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
                      <Button size="sm" onClick={() => setApproveFor({ order: o, payIndex: i })}>Approve payment</Button>
                      <Button size="sm" variant="ghost" onClick={() => adminReject(o, i)}>Reject payment</Button>
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
        <CardHeader
          title={`Payments (${shownPayRows.length} shown · ${pending.reduce((n, o) => n + o.payments.filter((p) => !p.verified).length, 0)} awaiting)`}
          action={isAdmin ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={recon.rows.length === 0} onClick={() => void verificationPDF(recon.rows, recon.summary, recon.filterLabel)}>Report (PDF)</Button>
              <Button size="sm" variant="secondary" disabled={recon.rows.length === 0} onClick={() => void verificationExcel(recon.rows, recon.filterLabel)}>Excel</Button>
            </div>
          ) : undefined}
        />
        <div className="flex flex-wrap items-center gap-3 sticky top-16 z-20 -mx-5 px-5 mb-3 border-b border-line bg-paper/95 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <SearchTimeBar q={query} setQ={setQuery} placeholder="Search — client, phone, or transaction ID…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} suggestions={searchSuggestions} />
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
                    {(p.method || p.bankName) && <div className="text-xs text-muted">{p.method}{p.bankName ? ` · ${p.bankName}` : ""}</div>}
                    {p.slipPath && <button type="button" onClick={() => void openSlip(p.slipPath!)} className="block text-xs text-gold-dark underline">View slip</button>}
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
                    ) : p.returnedForFix ? (
                      <div>
                        <Pill tone="gold">Returned to seller</Pill>
                        <div className="text-xs text-muted">to correct the id</div>
                      </div>
                    ) : p.flag ? (
                      <Pill tone="gold">Not in statement</Pill>
                    ) : (
                      <Pill tone="pending">Unverified</Pill>
                    )}
                  </Td>
                  <Td>
                    {(() => { const m = payMatch(o); return <Pill tone={m.tone === "green" ? "fulfilled" : m.tone === "blue" ? "info" : "gold"}>{m.label}</Pill>; })()}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {isDoubled(p) && (
                        <Button size="sm" variant="danger" onClick={() => void rejectDuplicate(o, i)}>Reject dup</Button>
                      )}
                      {p.voided ? (
                        <span className="text-xs text-muted">—</span>
                      ) : p.verified ? (
                        isDoubled(p) ? null : <span className="text-xs text-muted">—</span>
                      ) : p.pendingApproval ? (
                        isAdmin ? (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => setApproveFor({ order: o, payIndex: i })}>Approve</Button>
                            <Button size="sm" variant="ghost" onClick={() => adminReject(o, i)}>Reject</Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">with admin</span>
                        )
                      ) : p.returnedForFix ? (
                        <span className="text-xs text-muted">with seller</span>
                      ) : (
                        <Button size="sm" onClick={() => setManual({ order: o, payIndex: i })}>
                          Verify manually
                        </Button>
                      )}
                    </div>
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
          onSave={(ref, comment, choice) => saveManual(manual.order, manual.payIndex, ref, comment, choice)}
        />
      )}

      {approveFor && (
        <ApproveModal
          order={approveFor.order}
          payment={approveFor.order.payments[approveFor.payIndex]}
          onClose={() => setApproveFor(null)}
          onApprove={(note) => adminApprove(approveFor.order, approveFor.payIndex, note)}
        />
      )}
    </div>
  );
}

function ApproveModal({
  order,
  payment,
  onClose,
  onApprove,
}: {
  order: Order;
  payment: Payment;
  onClose: () => void;
  onApprove: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Approve payment — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!note.trim()) return setErr("A comment is required to approve this payment.");
              onApprove(note.trim());
            }}
          >
            Approve payment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink/60">
          Approving verifies <strong>{formatRWF(payment.amt)}</strong>
          {payment.pendingApproval?.refs?.length ? <> · <span className="font-mono text-xs">{payment.pendingApproval.refs.join(", ")}</span></> : null}
          {" "}even though it wasn&apos;t matched to a statement. Say why (e.g. confirmed with the bank / customer).
        </p>
        {payment.pendingApproval?.note && <p className="text-xs text-muted">Checker note: “{payment.pendingApproval.note}”</p>}
        <Field label="Approval comment (required)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this payment being approved?" />
        </Field>
        {err && <p className="text-sm text-status-refunded">{err}</p>}
      </div>
    </Modal>
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
  onSave: (ref: string, comment: string, choice: "auto" | "admin" | "seller") => void;
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

  const action: "cash" | "verify" | "missing" | "dup" =
    cash ? "cash" : allClean ? "verify" : anyMissing ? "missing" : "dup";
  const verifyLabel =
    action === "cash" ? "Confirm (cash)"
    : bankTotal !== payment.amt ? `Verify at ${formatRWF(bankTotal!)}` : "Confirm verification";

  const submit = (choice: "auto" | "admin" | "seller") => {
    if (!ref.trim()) return setErr("Enter the transaction id(s) or CASH.");
    if (!comment.trim()) return setErr("A comment is required.");
    onSave(ref.trim(), comment.trim(), choice);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Verify payment — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {action === "cash" || action === "verify" ? (
            <Button onClick={() => submit("auto")}>{verifyLabel}</Button>
          ) : action === "missing" ? (
            <>
              <Button variant="secondary" onClick={() => submit("seller")}>Return to seller to fix</Button>
              <Button onClick={() => submit("admin")}>Send to Admin</Button>
            </>
          ) : (
            <Button onClick={() => submit("admin")}>Send to Admin</Button>
          )}
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

        {action === "missing" && (
          <div className="rounded-lg border border-gold bg-gold-bg/50 px-3 py-2 text-sm text-gold-dark">
            One or more transaction ids aren’t in any statement. Choose <strong>Return to seller to fix</strong> — they correct
            the id and it comes back here to verify — or <strong>Send to Admin</strong> for approval.
            {payment.refFixed && <div className="mt-1 text-xs">The seller has already corrected this once.</div>}
          </div>
        )}
        {action === "dup" && (
          <div className="rounded-lg border border-gold bg-gold-bg/50 px-3 py-2 text-sm text-gold-dark">
            A reference is ambiguous (it appears with different amounts). This can’t be confirmed here — it will be
            <strong> sent to the Admin</strong> for the final decision.
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
