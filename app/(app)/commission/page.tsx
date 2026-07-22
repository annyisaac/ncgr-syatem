"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { SearchTimeBar } from "@/components/dashboard/DashKit";

import { formatRWF } from "@/lib/config";
import { formatDate, todayISO } from "@/lib/format";
import { presetToRange, type PeriodPreset } from "@/lib/period";
import { visibleOrders } from "@/lib/permissions";
import { commissionByDSR } from "@/lib/commission";
import {
  approveCommission,
  initiateCommission,
  payCommissionNow,
  rejectCommission,
} from "@/lib/commissionActions";
import { commissionPDF } from "@/lib/reports";
import type { CommissionRequest } from "@/lib/types";

export default function CommissionPage() {
  const { user } = useAuth();
  const { orders, commissions, upsertOrder, upsertCommission, newId } = useData();
  const { toast } = useToast();

  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const range = presetToRange(preset, custom, todayISO());

  // The Accountant can pay/approve commissions like an admin.
  const isAdmin = user?.role === "Admin" || user?.role === "Accountant";
  const canInitiate =
    user?.role === "Tetra Zone Manager" || user?.role === "Ross Order Receiver";

  const rangeOrders = useMemo(() => {
    if (!user) return [];
    const vis = visibleOrders(orders, user);
    if (!range.from && !range.to) return vis;
    return vis.filter((o) => inRange(o.date, range));
  }, [orders, user, range]);

  const allRows = useMemo(() => commissionByDSR(rangeOrders), [rangeOrders]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? allRows.filter((r) => r.dsrName.toLowerCase().includes(s) || r.district.toLowerCase().includes(s)) : allRows;
  }, [allRows, q]);
  const rangeLabel = range.from || range.to ? `${range.from || "start"} to ${range.to || "today"}` : "All time";

  const pendingRequests = useMemo(
    () => commissions.filter((c) => c.status === "initiated"),
    [commissions]
  );

  if (!user) return null;

  /** Save only the orders that actually changed — re-sending the whole
   *  collection deletes rows this tab hasn't loaded yet. */
  function saveChanged(next: import("@/lib/types").Order[]) {
    const before = new Map(orders.map((o) => [o.id, o]));
    next.filter((o) => before.get(o.id) !== o).forEach((o) => void upsertOrder(o));
  }

  function initiate(dsrId: string, dsrName: string, product: CommissionRequest["product"]) {
    const res = initiateCommission(orders, dsrId, dsrName, product, user!, newId);
    if (!res) return toast("No commission currently due for this DSR.", "info");
    saveChanged(res.orders);
    upsertCommission(res.request);
    toast(`Commission request initiated for ${dsrName}.`);
  }

  function payNow(dsrId: string, dsrName: string, product: CommissionRequest["product"]) {
    const res = payCommissionNow(orders, dsrId, dsrName, product, user!, newId);
    if (!res) return toast("No commission currently due for this DSR.", "info");
    saveChanged(res.orders);
    upsertCommission(res.request);
    toast(`Commission paid to ${dsrName}.`);
  }

  function approve(req: CommissionRequest) {
    const res = approveCommission(req, orders, user!);
    saveChanged(res.orders);
    upsertCommission(res.request);
    toast(`Approved commission for ${req.dsrName}.`);
  }

  function reject(req: CommissionRequest) {
    const res = rejectCommission(req, orders, user!);
    saveChanged(res.orders);
    upsertCommission(res.request);
    toast(`Rejected commission request for ${req.dsrName}.`);
  }

  async function downloadPDF() {
    if (rows.length === 0) return toast("Nothing to export.", "info");
    await commissionPDF(rows, rangeLabel);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <SearchTimeBar q={q} setQ={setQ} placeholder="Search DSR — name or district…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />
        </div>
        <Button variant="secondary" onClick={downloadPDF}>Download PDF report</Button>
      </div>

      <p className="text-xs text-ink/60">
        Rates: 100 RWF per delivered Tetra chick · 20 RWF per Ross 308 chick.
        Commission is due when delivered, or in advance when fully paid before delivery.
      </p>

      {/* Admin: pending requests */}
      {isAdmin && (
        <Card>
          <CardHeader title="Pending commission requests" />
          <TableWrap>
            <thead>
              <tr>
                <Th>DSR</Th>
                <Th>District</Th>
                <Th>Product</Th>
                <Th className="text-right">Chicks</Th>
                <Th className="text-right">Amount</Th>
                <Th>Initiated by</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {pendingRequests.length === 0 ? (
                <EmptyRow colSpan={7} text="No pending requests." />
              ) : (
                pendingRequests.map((c) => (
                  <tr key={c.id}>
                    <Td>{c.dsrName}</Td>
                    <Td>{c.district}</Td>
                    <Td>{c.product}</Td>
                    <Td className="text-right">{c.chicks.toLocaleString()}</Td>
                    <Td className="text-right">{formatRWF(c.amount)}</Td>
                    <Td>{c.by}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => approve(c)}>Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => reject(c)}>Reject</Button>
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {/* DSRs due */}
      <Card>
        <CardHeader title={`DSRs — ${rangeLabel}`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>DSR</Th>
              <Th>District</Th>
              <Th>Product</Th>
              <Th className="text-right">Eligible chicks</Th>
              <Th className="text-right">To give</Th>
              <Th className="text-right">Initiated</Th>
              <Th className="text-right">Given</Th>
              <Th>Status / Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={8} text="No commission-eligible orders in this period." />
            ) : (
              rows.map((r) => {
                const toGive = r.dueAmount;
                return (
                  <tr key={r.dsrId}>
                    <Td>{r.dsrName}</Td>
                    <Td>{r.district}</Td>
                    <Td>{r.product}</Td>
                    <Td className="text-right">{r.chicks.toLocaleString()}</Td>
                    <Td className="text-right">{formatRWF(toGive)}</Td>
                    <Td className="text-right">{formatRWF(r.initiatedAmount)}</Td>
                    <Td className="text-right">{formatRWF(r.paidAmount)}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        {r.advance > 0 && r.delivered === 0 && (
                          <Pill tone="gold">Paid (advance)</Pill>
                        )}
                        {canInitiate && toGive > 0 && (
                          <Button size="sm" onClick={() => initiate(r.dsrId, r.dsrName, r.product)}>
                            Initiate payment
                          </Button>
                        )}
                        {isAdmin && toGive > 0 && (
                          <Button size="sm" variant="secondary" onClick={() => payNow(r.dsrId, r.dsrName, r.product)}>
                            Pay now
                          </Button>
                        )}
                        {toGive === 0 && r.initiatedAmount === 0 && r.paidAmount > 0 && (
                          <Pill tone="fulfilled">Paid</Pill>
                        )}
                        {r.initiatedAmount > 0 && <Pill tone="info">Awaiting Admin</Pill>}
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {/* History of decided requests */}
      <Card>
        <CardHeader title="Commission request history" />
        <TableWrap>
          <thead>
            <tr>
              <Th>DSR</Th>
              <Th>Product</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th>Decided by</Th>
              <Th>On</Th>
            </tr>
          </thead>
          <tbody>
            {commissions.length === 0 ? (
              <EmptyRow colSpan={6} text="No commission requests yet." />
            ) : (
              commissions
                .slice()
                .sort((a, b) => (a.on < b.on ? 1 : -1))
                .map((c) => (
                  <tr key={c.id}>
                    <Td>{c.dsrName}</Td>
                    <Td>{c.product}</Td>
                    <Td className="text-right">{formatRWF(c.amount)}</Td>
                    <Td>
                      <Pill
                        tone={
                          c.status === "approved"
                            ? "fulfilled"
                            : c.status === "rejected"
                              ? "refunded"
                              : "gold"
                        }
                      >
                        {c.status}
                      </Pill>
                    </Td>
                    <Td>{c.decidedBy ?? "—"}</Td>
                    <Td>{c.decidedOn ? formatDate(c.decidedOn) : "—"}</Td>
                  </tr>
                ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
