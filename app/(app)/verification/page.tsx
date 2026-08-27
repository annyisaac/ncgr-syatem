"use client";

import { useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Kpi } from "@/components/dashboard/Kpi";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";

import type { BankStatement, Currency, Order, Payment } from "@/lib/types";
import { orderTotal } from "@/lib/types";
import { formatMoney } from "@/lib/config";
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
  guessDateColumn,
  guessPhoneColumn,
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
import { withHistory, recomputeCustomerCredit } from "@/lib/orders";
import { clientKey } from "@/lib/clients";

interface Staged {
  fileName: string;
  sheet: ParsedSheet;
  refCol: string;
  amtCol: string;
  dateCol: string;
  phoneCol: string;
  currency: Currency;
}

/** A checker may enter several transaction ids separated by a dash/space/comma. */
function splitRefs(input: string): string[] {
  return input.split(/[\s,\-]+/).map((s) => s.trim()).filter(Boolean);
}
function lookupRefs(refs: string[], statements: BankStatement[]) {
  const all = statements.flatMap((s) => s.rows ?? []).filter(Boolean);
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
  const cur = o.currency;
  if (paid > total) return { tone: "blue", label: `Overpaid +${formatMoney(paid - total, cur)}` };
  if (paid === total) return { tone: "green", label: "Paid in full" };
  if (paid > 0) return { tone: "gold", label: `Short ${formatMoney(total - paid, cur)}` };
  return { tone: "gold", label: `Owes ${formatMoney(total, cur)}` };
}

export default function VerificationPage() {
  const { user } = useAuth();
  const { orders, statements, availability, upsertStatement, removeStatement, upsertOrder, newId, reload } = useData();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // The Accountant is a finance actor here too (upload, auto-check, approve).
  const isAdmin = user?.role === "Admin" || user?.role === "Accountant";

  const [staged, setStaged] = useState<Staged | null>(null);
  const [showStatements, setShowStatements] = useState(false); // "view details" modal
  const [showApprovals, setShowApprovals] = useState(false);   // missing-payment approvals modal
  const [showAutoResults, setShowAutoResults] = useState(false); // automatic-check results modal
  const [stmtQuery, setStmtQuery] = useState("");                // search within uploaded statements
  const [pPage, setPPage] = useState(1);
  const [pSize, setPSize] = useState(10);
  const [outcomes, setOutcomes] = useState<AutoOutcome[]>([]);
  const [manual, setManual] = useState<{ order: Order; payIndex: number } | null>(null);
  const [slip, setSlip] = useState<{ path: string; url: string | null } | null>(null);
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

  // One flat, pre-normalised index of every statement transaction — built once
  // per statements change so the search only scans a plain array (fast, even
  // with tens of thousands of rows across all uploads).
  const stmtIndex = useMemo(
    () =>
      statements.flatMap((s) =>
        s.rows.map((r) => ({
          ref: r.ref,
          nref: normRef(r.ref),
          amt: r.amt,
          date: r.date,
          phone: r.phone,
          pdigits: (r.phone ?? "").replace(/\D/g, ""),
          file: s.fileName,
          currency: s.currency,
        }))
      ),
    [statements]
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
      // Open delivery dates from availability, plus any date that actually has
      // orders this checker can see — so a date whose availability row was
      // removed (but still carries orders) stays filterable, not hidden.
      const dates = new Set<string>();
      for (const a of availability) if (dateHasProduct(a, prod)) dates.add(a.id);
      const vis = user ? visibleOrders(orders, user) : [];
      for (const o of vis) if (o.date && (!prod || o.product === prod)) dates.add(o.date);
      return [
        { value: "", label: "All delivery dates" },
        ...[...dates].sort().map((d) => ({ value: d, label: formatDate(d) })),
      ];
    },
    [availability, user, orders]
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

  // Overview KPIs across the payments this user can see (non-voided).
  const stats = useMemo(() => {
    let received = 0, count = 0, verified = 0, verifiedAmt = 0, needsReview = 0, reviewAmt = 0;
    for (const { p } of payRows) {
      if (p.voided) continue;
      count++; received += p.amt;
      if (p.verified) { verified++; verifiedAmt += p.amt; }
      else { needsReview++; reviewAmt += p.amt; }
    }
    const pct = count ? Math.round((verified / count) * 1000) / 10 : 0;
    return { received, count, verified, verifiedAmt, pct, needsReview, reviewAmt };
  }, [payRows]);

  // Verified money grouped by each order's currency, no conversion (e.g. "9M RWF · $500").
  const verifiedByCurrency = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const { o, p } of payRows) {
      if (p.verified && !p.voided) { const c = o.currency ?? "RWF"; sums[c] = (sums[c] ?? 0) + p.amt; }
    }
    const parts = (["RWF", "USD", "EUR"] as const).filter((c) => sums[c]).map((c) => formatMoney(sums[c], c));
    return parts.length ? parts.join(" · ") : "0 RWF";
  }, [payRows]);

  // Reconciliation queue — work prioritised by the action it needs.
  const queue = useMemo(() => {
    const verifiedRefs = new Set<string>();
    for (const { p } of payRows) if (p.verified && !p.voided) {
      for (const r of [p.checkedRef, p.ref]) { const n = r ? normRef(r) : ""; if (n) verifiedRefs.add(n); }
    }
    const stmtRefs = new Set<string>();
    for (const s of statements) for (const r of s.rows) { const n = normRef(r.ref); if (n) stmtRefs.add(n); }
    let unmatchedBank = 0;
    for (const n of stmtRefs) if (!verifiedRefs.has(n)) unmatchedBank++;
    let partial = 0;
    for (const o of myOrders) {
      const paid = o.payments.filter((p) => p.verified && !p.voided).reduce((s, p) => s + p.amt, 0);
      if (paid > 0 && paid < orderTotal(o)) partial++;
    }
    return { missingApprovals: approvalRows.length, unmatchedBank, partial };
  }, [payRows, statements, myOrders, approvalRows]);

  // Reconciliation progress across payments (non-voided): matched / review / unmatched.
  const hero = useMemo(() => {
    let matched = 0, review = 0, unmatched = 0, total = 0;
    for (const { p } of payRows) {
      if (p.voided) continue;
      total++;
      if (p.verified) matched++;
      else if (p.pendingApproval || p.returnedForFix || p.flag) review++;
      else unmatched++;
    }
    const pct = total ? Math.round((matched / total) * 100) : 0;
    const w = (n: number) => (total ? (n / total) * 100 : 0);
    return { matched, review, unmatched, total, pct, matchedW: w(matched), reviewW: w(review) };
  }, [payRows]);

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
        dateCol: guessDateColumn(sheet.headers),
        phoneCol: guessPhoneColumn(sheet.headers),
        currency: "RWF",
      });
    } catch {
      toast("Could not read that file.", "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function addStatement() {
    if (!staged) return;
    const allRows = buildStatementRows(staged.sheet, staged.refCol, staged.amtCol, staged.dateCol || undefined, staged.phoneCol || undefined);
    if (allRows.length === 0) {
      toast("No rows found with those columns.", "error");
      return;
    }
    // One transaction id per table: only keep transactions we don't already have
    // (across every uploaded statement), and drop duplicates within this file too.
    const existingRefs = new Set<string>();
    for (const s of statements) for (const r of s.rows) { const n = normRef(r.ref); if (n) existingRefs.add(n); }
    const seen = new Set<string>();
    const rows = allRows.filter((r) => {
      const n = normRef(r.ref);
      if (!n || existingRefs.has(n) || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    const skipped = allRows.length - rows.length;
    if (rows.length === 0) {
      toast(`All ${allRows.length} transactions are already in the table — nothing new added.`, "info");
      setStaged(null);
      return;
    }
    const stmt: BankStatement = {
      id: newId("stmt"),
      fileName: staged.fileName,
      uploadedBy: user!.email,
      uploadedOn: nowISO(),
      refColumn: staged.refCol,
      amtColumn: staged.amtCol,
      dateColumn: staged.dateCol || undefined,
      phoneColumn: staged.phoneCol || undefined,
      currency: staged.currency,
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
    void saveWithRebalance(res.orders.filter((o) => before.get(o.id) !== o));
    const cleared = res.outcomes.filter((x) => x.result === "verified" || x.result === "corrected").length;
    setOutcomes(res.outcomes);
    if (res.outcomes.length > 0) setShowAutoResults(true);
    const skippedNote = skipped > 0 ? ` (skipped ${skipped} already in the table)` : "";
    toast(
      cleared > 0
        ? `Added ${rows.length} new transaction(s)${skippedNote} — ${cleared} payment(s) auto-verified.`
        : `Added ${rows.length} new transaction(s)${skippedNote}.`
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
    void saveWithRebalance(res.orders.filter((o) => before.get(o.id) !== o));
    setOutcomes(res.outcomes);
    if (res.outcomes.length > 0) setShowAutoResults(true);
    const verified = res.outcomes.filter((o) => o.result === "verified" || o.result === "corrected").length;
    toast(`Automatic check done — ${verified} verified/corrected, ${res.outcomes.length} checked.`);
  }

  // Save the changed orders AND re-balance each affected customer's applied
  // credit across their orders, so credit freed by a verification / correction /
  // rejection flows to that customer's other underpaid orders. The DB clamp
  // already prevents excess credit; this reallocates. (Existing orders only.)
  async function saveWithRebalance(changed: Order[]): Promise<void> {
    if (changed.length === 0) return;
    let toSave: Order[] = changed;
    try {
      if (user) {
        const byId = new Map(changed.map((o) => [o.id, o] as const));
        const merged = orders.map((o) => byId.get(o.id) ?? o);
        const finalById = new Map<string, Order>(byId);
        const seen = new Set<string>();
        for (const o of changed) {
          const key = clientKey(o);
          if (seen.has(key)) continue;
          seen.add(key);
          for (const cc of recomputeCustomerCredit(merged, o, user)) finalById.set(cc.id, cc);
        }
        toSave = [...finalById.values()];
      }
    } catch {
      toSave = changed; // rebalancing must never block the actual payment save
    }
    await Promise.all(toSave.map((o) => upsertOrder(o)));
  }

  async function openSlip(path: string) {
    setSlip({ path, url: null }); // open the preview immediately with a loading state
    const url = await paymentSlipUrl(path);
    if (!url) { toast("Could not load the slip.", "error"); setSlip(null); return; }
    setSlip({ path, url });
  }

  async function patchPayment(order: Order, payIndex: number, patch: Partial<Payment>, line: string): Promise<boolean> {
    const payments = order.payments.map((p, i) => (i === payIndex ? { ...p, ...patch } : p));
    // Single-row write: replacing the whole collection would delete any order
    // created since this tab loaded.
    try {
      await saveWithRebalance([withHistory({ ...order, payments }, user!, line)]);
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
      toast(corrected ? `Verified — amount set to ${formatMoney(amt, order.currency)} from the statement.` : `Verified ${formatMoney(amt, order.currency)} from the statement.`);
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
      `Admin approved payment (${refs.length ? refs.join(", ") : ref}) — ${formatMoney(p0.amt, order.currency)} — ${note}`);
    if (!ok) return;
    toast("Payment approved and verified.");
    setApproveFor(null);
  }
  function adminReject(order: Order, payIndex: number) {
    const p0 = order.payments[payIndex];
    void patchPayment(order, payIndex,
      { verified: false, voided: true, pendingApproval: undefined, flag: "Rejected by Admin — not in statements" },
      `Admin rejected payment (${(p0.pendingApproval?.refs ?? []).join(", ")}) — voided, ${formatMoney(p0.amt, order.currency)} removed from paid`);
    toast("Payment rejected and voided — no longer counts as paid.", "info");
  }

  // Any checker (or the Admin) can reject a DOUBLED payment on the spot — no
  // Admin approval needed. Voiding it fires the "Payment rejected" notification,
  // which reaches every Admin (they're always in the order audience).
  async function rejectDuplicate(order: Order, payIndex: number) {
    const p0 = order.payments[payIndex];
    if (typeof window !== "undefined" && !window.confirm(
      `Reject this DUPLICATE payment?\n\n${order.name} · ${formatMoney(p0.amt, order.currency)} · ref ${p0.ref}\n\nThe payment is voided (stops counting as paid) and the Admin is notified.`
    )) return;
    const ok = await patchPayment(order, payIndex,
      { verified: false, voided: true, verifiedBy: undefined, verifiedOn: undefined, pendingApproval: undefined, returnedForFix: undefined, flag: `Rejected as duplicate by ${user!.name}` },
      `Payment (${p0.ref}) rejected as a DUPLICATE reference by ${user!.name} — ${formatMoney(p0.amt, order.currency)} voided`);
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
    const changed: Order[] = [];
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
        updated = withHistory({ ...updated, payments }, user!, `Admin approved payment (${refs.length ? refs.join(", ") : ref}) — ${formatMoney(p0.amt, order.currency)} — ${note}`);
        count++;
      }
      if (updated !== order) changed.push(updated);
    }
    void saveWithRebalance(changed);
    setSel(new Set());
    setBulkNote("");
    toast(count ? `${count} payment(s) approved.` : "Nothing to approve.", count ? "success" : "info");
  }

  function bulkReject() {
    let count = 0;
    const changed: Order[] = [];
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
        updated = withHistory({ ...updated, payments }, user!, `Admin rejected payment (${(p0.pendingApproval?.refs ?? []).join(", ")}) — voided, ${formatMoney(p0.amt, order.currency)} removed from paid`);
        count++;
      }
      if (updated !== order) changed.push(updated);
    }
    void saveWithRebalance(changed);
    setSel(new Set());
    toast(count ? `${count} payment(s) rejected and voided.` : "Nothing to reject.", "info");
  }

  const pageCount = Math.max(1, Math.ceil(shownPayRows.length / pSize));
  const safePage = Math.min(pPage, pageCount);
  const pageRows = shownPayRows.slice((safePage - 1) * pSize, safePage * pSize);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Reconcile payments</h1>
          <p className="mt-1 text-sm text-muted">Match customer payments to your bank statement, then approve.</p>
        </div>
        <div className="text-sm text-muted">
          <span className="font-semibold text-ink">{user.name}</span> · {user.role}
        </div>
      </div>

      {/* Overview — click a card to filter the list */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi compact icon="money" tone="gold" value={stats.count.toLocaleString()} label="Total payments" sub={`${hero.pct}% reconciled`} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
        <Kpi compact icon="check" tone="green" value={stats.verified.toLocaleString()} label="Matched" sub={verifiedByCurrency} active={statusFilter === "checked"} onClick={() => setStatusFilter((f) => (f === "checked" ? "all" : "checked"))} />
        <Kpi compact icon="pending" tone="amber" value={stats.needsReview.toLocaleString()} label="Needs review" active={statusFilter === "unverified"} onClick={() => setStatusFilter((f) => (f === "unverified" ? "all" : "unverified"))} />
        <Kpi compact icon="orders" tone="blue" value={queue.missingApprovals.toLocaleString()} label="Awaiting approval" active={statusFilter === "awaiting"} onClick={() => setStatusFilter((f) => (f === "awaiting" ? "all" : "awaiting"))} />
        <Kpi compact icon="alert" tone="red" value={queue.unmatchedBank.toLocaleString()} label="Unmatched" sub="bank items" onClick={isAdmin ? () => setShowApprovals(true) : undefined} />
      </div>

      {/* Add your latest bank statement */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={isAdmin ? () => fileRef.current?.click() : undefined}
              disabled={!isAdmin}
              title={isAdmin ? "Upload a statement" : undefined}
              aria-label={isAdmin ? "Upload a statement" : undefined}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-bg text-gold-dark transition ${isAdmin ? "cursor-pointer hover:brightness-95 hover:ring-2 hover:ring-gold/40" : "cursor-default"}`}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13V4M6.5 7.5 10 4l3.5 3.5M4 15.5h12" /></svg>
            </button>
            <div>
              <h3 className="text-sm font-extrabold text-ink">Add your latest bank statement</h3>
              <p className="text-xs text-muted">
                {isAdmin
                  ? "CSV, XLSX or bank export — we match against open orders automatically."
                  : "Uploaded by the Admin; used to verify payments."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && <Button size="sm" variant="ghost" onClick={runAuto}>Run automatic check</Button>}
            <Button size="sm" variant="ghost" onClick={() => setShowStatements(true)}>View details ({statements.length})</Button>
          </div>
        </div>

        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />

        {staged && (
          <div className="mt-4 rounded-xl border border-line bg-field/50 p-3">
            <p className="mb-2 text-sm font-medium text-ink">Map columns for “{staged.fileName}”</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Reference column"><Select value={staged.refCol} onChange={(e) => setStaged({ ...staged, refCol: e.target.value })} options={staged.sheet.headers.map((h) => ({ value: h, label: h }))} /></Field>
              <Field label="Amount column"><Select value={staged.amtCol} onChange={(e) => setStaged({ ...staged, amtCol: e.target.value })} options={staged.sheet.headers.map((h) => ({ value: h, label: h }))} /></Field>
              <Field label="Date column (optional)"><Select value={staged.dateCol} onChange={(e) => setStaged({ ...staged, dateCol: e.target.value })} options={[{ value: "", label: "— none —" }, ...staged.sheet.headers.map((h) => ({ value: h, label: h }))]} /></Field>
              <Field label="Phone / sender column (optional)"><Select value={staged.phoneCol} onChange={(e) => setStaged({ ...staged, phoneCol: e.target.value })} options={[{ value: "", label: "— none —" }, ...staged.sheet.headers.map((h) => ({ value: h, label: h }))]} /></Field>
              <Field label="Currency"><Select value={staged.currency} onChange={(e) => setStaged({ ...staged, currency: e.target.value as Currency })} options={[
                { value: "RWF", label: "RWF" }, { value: "USD", label: "USD" }, { value: "EUR", label: "EUR" },
              ]} /></Field>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStaged(null)}>Cancel</Button>
              <Button onClick={addStatement}>Save statement</Button>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span className="flex gap-1.5"><span className="font-bold text-green">✓</span>Exact matches prepared automatically.</span>
          <span className="flex gap-1.5"><span className="font-bold text-green">✓</span>Unclear payments go to your review queue.</span>
          <span className="flex gap-1.5"><span className="font-bold text-green">✓</span>Nothing is approved until you confirm.</span>
        </div>
      </Card>

      {/* Payments list + approvals (full width) */}

      {/* Payments to reconcile */}
      <Card>
        <div id="payments-list" className="mb-3 flex scroll-mt-20 flex-wrap items-center justify-between gap-2">
          <h3 className="card-title">Payments to reconcile</h3>
          {isAdmin && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={recon.rows.length === 0} onClick={() => void verificationPDF(recon.rows, recon.summary, recon.filterLabel)}>PDF</Button>
              <Button size="sm" variant="ghost" disabled={recon.rows.length === 0} onClick={() => void verificationExcel(recon.rows, recon.filterLabel)}>Excel</Button>
            </div>
          )}
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchTimeBar q={query} setQ={setQuery} placeholder="Search — client, phone, or transaction ID…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} suggestions={searchSuggestions} />
          </div>
          <div className="w-40"><Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} options={[
            { value: "all", label: "All products" },
            { value: "Tetra Super Harco", label: "Tetra Super Harco" },
            { value: "Ross 308", label: "Ross 308" },
          ]} /></div>
          <div className="w-44"><Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} options={deliveryDateOptions} /></div>
        </div>

        <div className="mb-1 flex flex-wrap gap-1.5">
          {([["all", "All"], ["unverified", "Needs review"], ["awaiting", "Awaiting admin"], ["checked", "Matched"], ["rejected", "Rejected"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setStatusFilter(v)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${statusFilter === v ? "border-onyx bg-onyx text-white" : "border-line bg-paper text-muted hover:border-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="hidden sm:block">
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
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={8} text="No payments match these filters." />
            ) : pageRows.map(({ o, p, i }) => {
              const initials = o.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase() || "?";
              const ross = o.product === "Ross 308";
              const m = payMatch(o);
              return (
                <tr key={`${o.id}-${i}`} className={p.verified ? "bg-green-bg/40" : undefined}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[0.65rem] font-extrabold ${ross ? "bg-blue-bg text-blue" : "bg-purple-bg text-purple"}`}>{initials}</span>
                      <span className="font-medium text-ink">{o.name}</span>
                    </div>
                  </Td>
                  <Td><Pill tone={ross ? "ross" : "tetra"}>{ross ? "Ross" : "Tetra"}</Pill></Td>
                  <Td className="whitespace-nowrap">{o.date}</Td>
                  <Td className="text-right font-semibold tabular-nums">{formatMoney(p.amt, o.currency)}</Td>
                  <Td>
                    <span className="tabular-nums">{p.ref}</span>
                    {(p.method || p.bankName) && <div className="text-xs text-muted">{p.method}{p.bankName ? ` · ${p.bankName}` : ""}</div>}
                    {p.slipPath && <button type="button" onClick={() => void openSlip(p.slipPath!)} className="block text-xs text-gold-dark underline">View slip</button>}
                    {p.flag && <div className="text-xs text-status-refunded">{p.flag}</div>}
                  </Td>
                  <Td>
                    {p.voided ? <Pill tone="red">Rejected</Pill>
                      : p.verified ? <Pill tone="fulfilled">Checked ✓</Pill>
                      : p.pendingApproval ? <Pill tone="gold">Awaiting admin</Pill>
                      : p.returnedForFix ? <Pill tone="gold">Returned</Pill>
                      : p.flag ? <Pill tone="gold">Not in statement</Pill>
                      : <Pill tone="pending">Unverified</Pill>}
                  </Td>
                  <Td><Pill tone={m.tone === "green" ? "fulfilled" : m.tone === "blue" ? "info" : "gold"}>{m.label}</Pill></Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {isDoubled(p) && <Button size="sm" variant="danger" onClick={() => void rejectDuplicate(o, i)}>Reject dup</Button>}
                      {p.voided ? (
                        <span className="text-xs text-muted">—</span>
                      ) : p.verified ? (
                        isDoubled(p) ? null : <span className="text-xs text-muted">—</span>
                      ) : p.pendingApproval ? (
                        isAdmin ? (
                          <><Button size="sm" onClick={() => setApproveFor({ order: o, payIndex: i })}>Approve</Button><Button size="sm" variant="ghost" onClick={() => adminReject(o, i)}>Reject</Button></>
                        ) : (
                          <span className="text-xs text-muted">with admin</span>
                        )
                      ) : p.returnedForFix ? (
                        <span className="text-xs text-muted">with seller</span>
                      ) : (
                        <Button size="sm" onClick={() => setManual({ order: o, payIndex: i })}>{p.flag ? "Find match" : "Review"}</Button>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        </div>

        {/* Mobile: each payment as a card — the wide table can't fit a phone. */}
        <div className="space-y-2.5 sm:hidden">
          {pageRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No payments match these filters.</p>
          ) : pageRows.map(({ o, p, i }) => {
            const initials = o.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase() || "?";
            const ross = o.product === "Ross 308";
            const m = payMatch(o);
            return (
              <div key={`${o.id}-${i}`} className={"rounded-2xl border p-3.5 shadow-card " + (p.verified ? "border-green/40 bg-green-bg/40" : "border-line bg-paper")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[0.65rem] font-extrabold ${ross ? "bg-blue-bg text-blue" : "bg-purple-bg text-purple"}`}>{initials}</span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{o.name}</p>
                      <p className="text-xs text-muted">{o.date}</p>
                    </div>
                  </div>
                  <Pill tone={ross ? "ross" : "tetra"}>{ross ? "Ross" : "Tetra"}</Pill>
                </div>
                <div className="mt-2.5 flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Reference</p>
                    <p className="truncate text-sm tabular-nums text-ink">{p.ref}</p>
                    {(p.method || p.bankName) && <p className="text-xs text-muted">{p.method}{p.bankName ? ` · ${p.bankName}` : ""}</p>}
                    {p.slipPath && <button type="button" onClick={() => void openSlip(p.slipPath!)} className="text-xs text-gold-dark underline">View slip</button>}
                    {p.flag && <p className="text-xs text-status-refunded">{p.flag}</p>}
                  </div>
                  <p className="shrink-0 text-right text-lg font-bold tabular-nums text-ink">{formatMoney(p.amt, o.currency)}</p>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {p.voided ? <Pill tone="red">Rejected</Pill>
                    : p.verified ? <Pill tone="fulfilled">Checked ✓</Pill>
                    : p.pendingApproval ? <Pill tone="gold">Awaiting admin</Pill>
                    : p.returnedForFix ? <Pill tone="gold">Returned</Pill>
                    : p.flag ? <Pill tone="gold">Not in statement</Pill>
                    : <Pill tone="pending">Unverified</Pill>}
                  <Pill tone={m.tone === "green" ? "fulfilled" : m.tone === "blue" ? "info" : "gold"}>{m.label}</Pill>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-line pt-2.5">
                  {isDoubled(p) && <Button size="sm" variant="danger" onClick={() => void rejectDuplicate(o, i)}>Reject dup</Button>}
                  {p.voided ? (
                    <span className="text-xs text-muted">—</span>
                  ) : p.verified ? (
                    isDoubled(p) ? null : <span className="text-xs text-muted">—</span>
                  ) : p.pendingApproval ? (
                    isAdmin ? (
                      <><Button size="sm" onClick={() => setApproveFor({ order: o, payIndex: i })}>Approve</Button><Button size="sm" variant="ghost" onClick={() => adminReject(o, i)}>Reject</Button></>
                    ) : (
                      <span className="text-xs text-muted">with admin</span>
                    )
                  ) : p.returnedForFix ? (
                    <span className="text-xs text-muted">with seller</span>
                  ) : (
                    <Button size="sm" onClick={() => setManual({ order: o, payIndex: i })}>{p.flag ? "Find match" : "Review"}</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {shownPayRows.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <Pagination page={safePage} pageSize={pSize} total={shownPayRows.length} noun="payments" onPageChange={setPPage} onPageSizeChange={(s) => { setPSize(s); setPPage(1); }} />
          </div>
        )}
      </Card>

      {/* Missing-payment approvals — opened from the "Unmatched" card */}
      {isAdmin && showApprovals && (
        <Modal open onClose={() => setShowApprovals(false)} title={`Missing-payment approvals (${approvalRows.length})`} className="max-w-5xl">
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
                  <Td className="text-right">{formatMoney(p.amt, o.currency)}</Td>
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
        </Modal>
      )}


      {/* Automatic check results — shown as a modal */}
      {showAutoResults && (
        <Modal open onClose={() => setShowAutoResults(false)} title="Automatic check results" className="max-w-3xl">
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
              {outcomes.length === 0 ? (
                <EmptyRow colSpan={4} text="No results." />
              ) : outcomes.map((o, i) => (
                <tr key={i}>
                  <Td>{o.client}</Td>
                  <Td>{o.ref}</Td>
                  <Td>
                    <Pill tone={o.result === "verified" ? "fulfilled" : o.result === "corrected" || o.result === "review" ? "gold" : o.result === "duplicate" ? "info" : "refunded"}>{o.result}</Pill>
                  </Td>
                  <Td>{o.detail}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Modal>
      )}


      {showStatements && (
        <Modal open onClose={() => { setShowStatements(false); setStmtQuery(""); }} title="Bank statements" className="max-w-3xl">
          {isAdmin && (
            <div className="mb-3">
              <Input value={stmtQuery} onChange={(e) => setStmtQuery(e.target.value)} placeholder="Search by phone number or transaction id — see amount & payment date…" />
            </div>
          )}
          {stmtQuery.trim() ? (
            (() => {
              const q = normRef(stmtQuery);
              const ql = stmtQuery.trim().toLowerCase();
              const qd = stmtQuery.replace(/\D/g, "");
              const hits = stmtIndex.filter((r) =>
                (q !== "" && r.nref.includes(q)) ||
                r.ref.toLowerCase().includes(ql) ||
                (qd.length >= 3 && r.pdigits.includes(qd))
              );
              const matches = hits.slice(0, 200);
              return (
                <>
                  <TableWrap>
                    <thead>
                      <tr>
                        <Th>Phone / sender</Th>
                        <Th>Transaction id</Th>
                        <Th className="text-right">Amount</Th>
                        <Th>Payment date</Th>
                        <Th>Statement</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.length === 0 ? (
                        <EmptyRow colSpan={5} text="No matching transaction in the statements. (Phone search needs a statement uploaded with a phone/sender column mapped.)" />
                      ) : matches.map((mm, idx) => (
                        <tr key={idx}>
                          <Td className="whitespace-nowrap">{mm.phone || <span className="text-muted">—</span>}</Td>
                          <Td className="font-mono text-xs">{mm.ref}</Td>
                          <Td className="text-right font-semibold tabular-nums">{formatMoney(mm.amt, mm.currency)}</Td>
                          <Td className="whitespace-nowrap">{mm.date || <span className="text-muted">—</span>}</Td>
                          <Td>{mm.file}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                  {hits.length > matches.length && <p className="mt-2 text-xs text-muted">Showing the first {matches.length} of {hits.length.toLocaleString()} matches — narrow your search.</p>}
                </>
              );
            })()
          ) : (
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
                        <Td><Button size="sm" variant="ghost" onClick={() => onRemoveStatement(s.id)}>Remove</Button></Td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </TableWrap>
          )}
        </Modal>
      )}

      {slip && (
        <Modal open onClose={() => setSlip(null)} title="Payment bank slip" className="max-w-2xl"
          footer={slip.url ? <a href={slip.url} target="_blank" rel="noopener noreferrer"><Button variant="secondary">Open in new tab</Button></a> : undefined}>
          {!slip.url ? (
            <p className="py-10 text-center text-sm text-muted">Loading slip…</p>
          ) : /\.pdf(\?|$)/i.test(slip.path) ? (
            <iframe src={slip.url} title="Payment bank slip" className="h-[70vh] w-full rounded-lg border border-line" />
          ) : (
            <img src={slip.url} alt="Payment bank slip" className="mx-auto max-h-[70vh] w-auto rounded-lg border border-line" />
          )}
        </Modal>
      )}

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
          Approving verifies <strong>{formatMoney(payment.amt, order.currency)}</strong>
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
    : bankTotal !== null && bankTotal !== payment.amt ? `Verify at ${formatMoney(bankTotal, order.currency)}` : "Confirm verification";

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
        <p className="text-sm text-ink/60">Recorded amount: <strong>{formatMoney(payment.amt, order.currency)}</strong></p>
        <Field label="Transaction id(s) — two ids separated by a dash, e.g. 291516404175-29165859045 · cash: write CASH">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>

        {!cash && refs.length > 0 && (
          <div className="space-y-1 rounded-lg border border-line bg-cream/40 p-2.5 text-sm">
            {lookups.map((l, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{l.ref}</span>
                {l.matches.length === 1 ? (
                  <span className="shrink-0 text-green">found · {formatMoney(l.matches[0].amt, order.currency)}</span>
                ) : l.matches.length > 1 ? (
                  <span className="shrink-0 text-gold-dark">appears {l.matches.length}× · review</span>
                ) : (
                  <span className="shrink-0 text-red">not in any statement</span>
                )}
              </div>
            ))}
            {allClean && bankTotal !== null && (
              <div className="flex items-center justify-between border-t border-line pt-1 font-semibold">
                <span>Total from statement</span><span>{formatMoney(bankTotal, order.currency)}</span>
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
            Recorded <strong>{formatMoney(payment.amt, order.currency)}</strong> but the statement total is <strong>{formatMoney(bankTotal!, order.currency)}</strong>.
            On confirm the amount will be set to <strong>{formatMoney(bankTotal!, order.currency)}</strong>.
          </div>
        )}
        {(action === "verify" || action === "cash") && (() => {
          const amt = action === "verify" ? bankTotal! : payment.amt;
          const otherVerified = order.payments.filter((pp) => pp !== payment && pp.verified).reduce((s, pp) => s + pp.amt, 0);
          const paid = otherVerified + amt;
          const total = orderTotal(order);
          const cls = paid === total ? "text-green" : "text-gold-dark";
          const state = paid > total ? `overpaid by ${formatMoney(paid - total, order.currency)}` : paid === total ? "paid in full" : `still short ${formatMoney(total - paid, order.currency)}`;
          return (
            <div className="rounded-lg border border-line bg-cream/40 px-3 py-2 text-sm">
              After this the order will have <strong>{formatMoney(paid, order.currency)}</strong> of <strong>{formatMoney(total, order.currency)}</strong> owed — <strong className={cls}>{state}</strong>.
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
