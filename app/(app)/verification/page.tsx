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
import { formatRWF } from "@/lib/config";
import { formatDateTime, nowISO } from "@/lib/format";
import { visibleOrders } from "@/lib/permissions";
import {
  buildStatementRows,
  guessAmountColumn,
  guessRefColumn,
  parseWorkbook,
  type ParsedSheet,
} from "@/lib/excel";
import { runAutoCheck, type AutoOutcome } from "@/lib/verification";
import { withHistory } from "@/lib/orders";

interface Staged {
  fileName: string;
  sheet: ParsedSheet;
  refCol: string;
  amtCol: string;
}

export default function VerificationPage() {
  const { user } = useAuth();
  const { orders, statements, setStatements, removeStatement: deleteStatement, setOrders, newId } = useData();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin = user?.role === "Admin";

  const [staged, setStaged] = useState<Staged | null>(null);
  const [outcomes, setOutcomes] = useState<AutoOutcome[]>([]);
  const [manual, setManual] = useState<{ order: Order; payIndex: number } | null>(null);

  const myOrders = useMemo(
    () => (user ? visibleOrders(orders, user).filter((o) => o.confirmedOk) : []),
    [orders, user]
  );
  const visibleIds = useMemo(() => new Set(myOrders.map((o) => o.id)), [myOrders]);

  // Orders with at least one unverified payment.
  const pending = useMemo(
    () => myOrders.filter((o) => o.payments.some((p) => !p.verified)),
    [myOrders]
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
    setStatements([...statements, stmt]);
    setStaged(null);
    toast(`Added statement "${stmt.fileName}" (${rows.length} rows).`);
  }

  async function removeStatement(id: string) {
    await deleteStatement(id);
    toast("Statement removed.");
  }

  function runAuto() {
    if (statements.length === 0) {
      toast("Upload at least one bank statement first.", "info");
      return;
    }
    const res = runAutoCheck(orders, statements, user!, visibleIds);
    setOrders(res.orders);
    setOutcomes(res.outcomes);
    const verified = res.outcomes.filter((o) => o.result === "verified" || o.result === "corrected").length;
    toast(`Automatic check done — ${verified} verified/corrected, ${res.outcomes.length} checked.`);
  }

  function saveManual(order: Order, payIndex: number, ref: string, comment: string) {
    const payments = order.payments.map((p, i) =>
      i === payIndex
        ? {
            ...p,
            verified: true,
            verifiedBy: user!.email,
            verifiedOn: nowISO(),
            checkedRef: ref,
            comment,
            flag: undefined,
          }
        : p
    );
    const line = `Manually verified payment (ref ${ref}) — ${comment}`;
    setOrders(
      orders.map((o) =>
        o.id === order.id ? withHistory({ ...order, payments }, user!, line) : o
      )
    );
    toast("Payment verified.");
    setManual(null);
  }

  return (
    <div className="space-y-6">
      <h1 className="section-heading text-lg">Payment Verification</h1>

      {/* Statements (Admin only) */}
      {isAdmin ? (
        <Card>
          <CardHeader title="Bank statements" />
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

          <div className="mt-4">
            <TableWrap>
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th className="text-right">Rows</Th>
                  <Th>Uploaded</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {statements.length === 0 ? (
                  <EmptyRow colSpan={4} text="No statements uploaded." />
                ) : (
                  statements.map((s) => (
                    <tr key={s.id}>
                      <Td>{s.fileName}</Td>
                      <Td className="text-right">{s.rows.length}</Td>
                      <Td>{formatDateTime(s.uploadedOn)}</Td>
                      <Td>
                        <Button size="sm" variant="ghost" onClick={() => removeStatement(s.id)}>
                          Remove
                        </Button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableWrap>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-ink/60">
            Bank statements are uploaded by the Admin. Use manual verification
            below to verify payments you have confirmed (cash allowed — write
            CASH as the reference).
          </p>
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

      {/* Manual check */}
      <Card>
        <CardHeader title="Manual verification" />
        <p className="mb-3 text-sm text-ink/60">
          Manual check ignores the statements. Type the reference you verified
          (cash allowed — write CASH) and a required comment.
        </p>
        <TableWrap>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Product</Th>
              <Th>Delivery</Th>
              <Th className="text-right">Amount</Th>
              <Th>Reference</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 ? (
              <EmptyRow colSpan={7} text="No payments awaiting verification." />
            ) : (
              pending.flatMap((o) =>
                o.payments.map((p, i) =>
                  p.verified ? null : (
                    <tr key={`${o.id}-${i}`}>
                      <Td>{o.name}</Td>
                      <Td>{o.product}</Td>
                      <Td>{o.date}</Td>
                      <Td className="text-right">{formatRWF(p.amt)}</Td>
                      <Td>
                        {p.ref}
                        {p.flag && (
                          <div className="text-xs text-status-refunded">{p.flag}</div>
                        )}
                      </Td>
                      <Td><Pill tone="pending">Unverified</Pill></Td>
                      <Td>
                        <Button size="sm" onClick={() => setManual({ order: o, payIndex: i })}>
                          Verify manually
                        </Button>
                      </Td>
                    </tr>
                  )
                )
              )
            )}
          </tbody>
        </TableWrap>
      </Card>

      {manual && (
        <ManualModal
          order={manual.order}
          payment={manual.order.payments[manual.payIndex]}
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
  onClose,
  onSave,
}: {
  order: Order;
  payment: Payment;
  onClose: () => void;
  onSave: (ref: string, comment: string) => void;
}) {
  const [ref, setRef] = useState(payment.ref);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
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
              if (!ref.trim()) return setErr("Enter the reference (or CASH).");
              if (!comment.trim()) return setErr("A comment is required.");
              onSave(ref.trim(), comment.trim());
            }}
          >
            Confirm verification
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink/60">Amount: <strong>{formatRWF(payment.amt)}</strong></p>
        <Field label="Reference verified (cash allowed — write CASH)">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field label="Comment (required)">
          <Input value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {err && <p className="text-sm text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}
