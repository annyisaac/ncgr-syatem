"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";

import { formatRWF } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { balance, paidAmount, orderTotal } from "@/lib/types";
import { visibleOrders } from "@/lib/permissions";
import {
  commissionByDSR,
  isCommissionEligible,
  orderCommission,
} from "@/lib/commission";
import {
  dueOrdersForDSR,
  initiateCommission,
  payCommissionNow,
} from "@/lib/commissionActions";

export default function DSRDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const { dsrs, orders, setOrders, upsertCommission, newId } = useData();
  const { toast } = useToast();

  const dsr = dsrs.find((d) => d.id === id);

  const dsrOrders = useMemo(() => {
    if (!user) return [];
    return visibleOrders(orders, user).filter((o) => o.dsrId === id);
  }, [orders, user, id]);

  const commissionRow = useMemo(
    () => commissionByDSR(dsrOrders)[0],
    [dsrOrders]
  );

  if (!dsr) {
    return (
      <div className="space-y-4">
        <Link href="/dsrs" className="text-sm text-gold-dark underline">
          ← Back to DSRs
        </Link>
        <Card>
          <p className="text-sm text-ink/60">DSR not found.</p>
        </Card>
      </div>
    );
  }

  const isAdmin = user?.role === "Admin";
  const canInitiate =
    user?.role === "Tetra Zone Manager" || user?.role === "Ross Order Receiver";
  const due = dueOrdersForDSR(dsrOrders, dsr.id);
  // Determine product from the DSR's orders (fallback Tetra).
  const dsrProduct = dsrOrders[0]?.product ?? "Tetra Super Harco";

  function handleInitiate() {
    if (!user || !dsr) return;
    const res = initiateCommission(orders, dsr.id, dsr.name, dsrProduct, user, newId);
    if (!res) {
      toast("No commission due for this DSR.", "info");
      return;
    }
    setOrders(res.orders);
    upsertCommission(res.request);
    toast(`Commission request initiated for ${dsr.name}.`);
  }

  function handlePayNow() {
    if (!user || !dsr) return;
    const res = payCommissionNow(orders, dsr.id, dsr.name, dsrProduct, user, newId);
    if (!res) {
      toast("No commission due for this DSR.", "info");
      return;
    }
    setOrders(res.orders);
    upsertCommission(res.request);
    toast(`Commission paid to ${dsr.name}.`);
  }

  return (
    <div className="space-y-6">
      <Link href="/dsrs" className="text-sm text-gold-dark underline">
        ← Back to DSRs
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">{dsr.name}</h1>
        {dsr.active ? (
          <Pill tone="fulfilled">Active</Pill>
        ) : (
          <Pill tone="neutral">Inactive</Pill>
        )}
      </div>

      <Card>
        <CardHeader title="Profile" />
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Info label="Phone" value={dsr.phone} />
          <Info label="Province" value={dsr.province} />
          <Info label="District" value={dsr.district} />
          <Info label="Zone" value={dsr.zone} />
          <div className="col-span-2 sm:col-span-4">
            <Info label="Sectors" value={dsr.sectors.join(", ") || "—"} />
          </div>
        </div>
      </Card>

      {/* Commission controls */}
      <Card>
        <CardHeader title="Commission" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Info label="Eligible chicks" value={String(commissionRow?.chicks ?? 0)} />
          <Info label="Total commission" value={formatRWF(commissionRow?.amount ?? 0)} />
          <Info label="To give" value={formatRWF((commissionRow?.dueAmount ?? 0) + (commissionRow?.initiatedAmount ?? 0))} />
          <Info label="Given" value={formatRWF(commissionRow?.paidAmount ?? 0)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {canInitiate && (
            <Button onClick={handleInitiate} disabled={due.length === 0}>
              Initiate payment
            </Button>
          )}
          {isAdmin && (
            <Button onClick={handlePayNow} disabled={due.length === 0}>
              Pay now
            </Button>
          )}
          {due.length === 0 && (
            <span className="self-center text-xs text-ink/50">
              No commission currently due.
            </span>
          )}
        </div>
      </Card>

      {/* Orders */}
      <Card>
        <CardHeader title="Orders" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Delivery date</Th>
              <Th>Client</Th>
              <Th>Sector</Th>
              <Th className="text-right">Chicks</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
              <Th className="text-right">Commission</Th>
            </tr>
          </thead>
          <tbody>
            {dsrOrders.length === 0 ? (
              <EmptyRow colSpan={9} text="No orders for this DSR yet." />
            ) : (
              dsrOrders.map((o) => (
                <tr key={o.id}>
                  <Td>{formatDate(o.date)}</Td>
                  <Td>{o.name}</Td>
                  <Td>{o.sector}</Td>
                  <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                  <Td className="text-right">{formatRWF(orderTotal(o))}</Td>
                  <Td className="text-right">{formatRWF(paidAmount(o))}</Td>
                  <Td className="text-right">{formatRWF(balance(o))}</Td>
                  <Td>
                    <Pill
                      tone={
                        o.status === "fulfilled"
                          ? "fulfilled"
                          : o.status === "refunded"
                            ? "refunded"
                            : o.status === "rejected"
                              ? "red"
                              : "pending"
                      }
                    >
                      {o.status}
                    </Pill>
                  </Td>
                  <Td className="text-right">
                    {isCommissionEligible(o) ? (
                      o.commPaid ? (
                        <Pill tone="fulfilled">Paid {formatRWF(orderCommission(o))}</Pill>
                      ) : o.commReq ? (
                        <Pill tone="gold">Initiated</Pill>
                      ) : (
                        <span>{formatRWF(orderCommission(o))}</span>
                      )
                    ) : (
                      <span className="text-ink/40">—</span>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink/60">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}
