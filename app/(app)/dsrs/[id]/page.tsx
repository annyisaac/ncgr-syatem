"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";

import { formatRWF } from "@/lib/config";
import { formatDate, todayISO, nowISO, isValidEmail } from "@/lib/format";
import { balance, paidAmount, orderTotal } from "@/lib/types";
import type { DSR, Order } from "@/lib/types";
import { adminCreateUser, adminSetPassword } from "@/lib/adminApi";
import { genDsrCode } from "@/lib/dsrAuth";
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
  const { dsrs, orders, upsertOrder, upsertCommission, upsertDSR, newId } = useData();

  /** Save only the orders that changed — never re-send the whole collection. */
  const saveChanged = (next: import("@/lib/types").Order[]) => {
    const before = new Map(orders.map((o) => [o.id, o]));
    next.filter((o) => before.get(o.id) !== o).forEach((o) => void upsertOrder(o));
  };
  const { toast } = useToast();
  const [targetInput, setTargetInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

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
    saveChanged(res.orders);
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
    saveChanged(res.orders);
    upsertCommission(res.request);
    toast(`Commission paid to ${dsr.name}.`);
  }

  async function setupLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!dsr) return;
    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;
    setAuthErr(null);
    if (!isValidEmail(email)) return setAuthErr("Enter a valid email address.");
    if (password.length < 6) return setAuthErr("Password must be at least 6 characters.");
    setBusy(true);
    try {
      const code = dsr.loginCode ?? genDsrCode(dsrs.map((d) => d.loginCode).filter(Boolean) as string[]);
      // Create the account; if that email already has one, just (re)set its password.
      try {
        await adminCreateUser(email, password, { name: dsr.name, email, role: "DSR", password: "", active: true, created: nowISO() });
      } catch (err) {
        const m = err instanceof Error ? err.message.toLowerCase() : "";
        if (m.includes("exist") || m.includes("registered") || m.includes("already")) {
          await adminSetPassword(email, password);
        } else {
          throw err;
        }
      }
      await upsertDSR({ ...dsr, loginCode: code, authEmail: email, deviceId: undefined, deviceLabel: undefined });
      setLoginEmail(""); setLoginPassword("");
      toast(`Login set up for ${dsr.name} — code ${code}.`);
    } catch (err) {
      setAuthErr(err instanceof Error ? err.message : "Could not set up login.");
    } finally {
      setBusy(false);
    }
  }

  function resetDevice() {
    if (!dsr) return;
    upsertDSR({ ...dsr, deviceId: undefined, deviceLabel: undefined });
    toast(`Device reset — ${dsr.name} can sign in on a new device.`);
  }

  const canResetDevice = isAdmin || canInitiate;

  return (
    <div className="space-y-6">
      <Link href="/dsrs" className="text-sm text-gold-dark underline">
        ← Back to DSRs
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
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

      {/* Monthly target */}
      <TargetCard
        dsr={dsr}
        orders={dsrOrders}
        canSet={user?.role === "Admin" || user?.role === "Tetra Zone Manager" || user?.role === "Ross Order Receiver"}
        targetInput={targetInput}
        setTargetInput={setTargetInput}
        onSave={(chicks) => { upsertDSR({ ...dsr, monthlyTarget: chicks }); toast(`Monthly target set to ${chicks.toLocaleString()} chicks.`); setTargetInput(""); }}
      />

      {/* DSR portal login */}
      <Card>
        <CardHeader title="Portal login" />
        <p className="mb-3 text-sm text-muted">
          The DSR signs in on the normal login page with the email &amp; password below,
          then enters their code once to trust a new device.
        </p>

        {dsr.authEmail ? (
          <div className="space-y-2 text-sm">
            <p>Login email: <span className="font-mono">{dsr.authEmail}</span></p>
            <p>Zone-manager code: <span className="rounded bg-cream px-2 py-0.5 font-mono text-base font-bold">{dsr.loginCode}</span></p>
            <p className="flex items-center gap-2">Trusted device:{" "}
              {dsr.deviceId
                ? <Pill tone="fulfilled">{dsr.deviceLabel || "a device"}</Pill>
                : <Pill tone="gold">None yet — set on first code entry</Pill>}
            </p>
            {canResetDevice && <Button variant="ghost" size="sm" onClick={resetDevice}>Reset device</Button>}
          </div>
        ) : (
          <p className="text-sm text-muted">No login set up yet{isAdmin ? "." : " — an Admin can set it up."}</p>
        )}

        {isAdmin && (
          <form onSubmit={setupLogin} className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <Field label={dsr.authEmail ? "Change login email" : "Login email"}>
              <Input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder={dsr.authEmail || "dsr@example.com"} />
            </Field>
            <Field label={dsr.authEmail ? "Set new password" : "Initial password"} hint="At least 6 characters.">
              <Input type="text" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Give this to the DSR" />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : dsr.authEmail ? "Update login" : "Set up login"}</Button>
              {authErr && <p className="mt-2 text-sm text-status-refunded">{authErr}</p>}
            </div>
          </form>
        )}
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

function TargetCard({
  dsr, orders, canSet, targetInput, setTargetInput, onSave,
}: {
  dsr: DSR;
  orders: Order[];
  canSet: boolean;
  targetInput: string;
  setTargetInput: (v: string) => void;
  onSave: (chicks: number) => void;
}) {
  const month = todayISO().slice(0, 7); // yyyy-mm
  const monthName = new Date(month + "-01T00:00:00").toLocaleString("en-US", { month: "long", year: "numeric" });
  const target = dsr.monthlyTarget ?? 0;
  const done = orders
    .filter((o) => o.date.slice(0, 7) === month && o.status !== "refunded" && o.status !== "rejected")
    .reduce((s, o) => s + o.chicks, 0);
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;

  return (
    <Card>
      <CardHeader title={`Monthly target — ${monthName}`} />
      {target > 0 ? (
        <>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2 text-sm">
            <span><strong className="text-ink">{done.toLocaleString()}</strong> <span className="text-muted">of {target.toLocaleString()} chicks</span></span>
            <span className={pct >= 100 ? "font-bold text-green" : "font-semibold text-gold-dark"}>{pct}%{pct >= 100 ? " — target met" : ` · ${Math.max(0, target - done).toLocaleString()} to go`}</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-grey-bg">
            <div className={`h-full rounded-full ${pct >= 100 ? "bg-green" : "bg-gold"}`} style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">No monthly target set{canSet ? " — set one below." : "."}</p>
      )}
      {canSet && (
        <form onSubmit={(e) => { e.preventDefault(); const n = Number(targetInput) || 0; if (n > 0) onSave(n); }} className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Set monthly target (chicks)"><Input type="number" min={0} value={targetInput} onChange={(e) => setTargetInput(e.target.value)} placeholder={target ? String(target) : "e.g. 5000"} /></Field>
          <Button type="submit">Save target</Button>
        </form>
      )}
    </Card>
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
