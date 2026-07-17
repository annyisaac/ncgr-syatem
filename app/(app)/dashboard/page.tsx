"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { DateRange, ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { Kpi } from "@/components/dashboard/Kpi";
import { LineChartView, PieChartView, DonutChartView, MultiLineChartView } from "@/components/charts/Charts";
import { GlobalSearch } from "@/components/sales/GlobalSearch";

import type { Order, BankStatement, User, DSR, Route } from "@/lib/types";
import { PRODUCTS } from "@/lib/types";
import { balance, orderTotal, paidAmount, toDeliver } from "@/lib/types";
import { formatRWF } from "@/lib/config";
import { provinceOfDistrict } from "@/lib/config";
import { formatDate, todayISO } from "@/lib/format";
import { visibleOrders } from "@/lib/permissions";
import { commissionByDSR } from "@/lib/commission";
import {
  downloadBackup,
  exportOrdersExcel,
  importOrdersExcel,
  readBackup,
} from "@/lib/reports";

export default function DashboardPage() {
  const { user } = useAuth();
  const { orders, replaceAll, setOrders, users, dsrs, commissions, statements, routes, availability, dsrVisits } = useData();
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);

  const visible = useMemo(() => (user ? visibleOrders(orders, user) : []), [orders, user]);

  const scoped = useMemo(() => {
    if (!user) return [];
    const vis = visibleOrders(orders, user);
    if (!range.from && !range.to) return vis;
    return vis.filter((o) => inRange(o.date, range));
  }, [orders, user, range]);

  if (!user) return null;

  // Payment checkers get a dedicated, self-contained dashboard (own filters).
  if (user.role === "Tetra Payment Checker" || user.role === "Ross Payment Checker") {
    return <CheckerDashboard orders={visible} statements={statements} user={user} />;
  }
  if (user.role === "Ross Order Receiver") {
    return <RossDashboard orders={visible} user={user} />;
  }
  if (user.role === "Tetra Zone Manager") {
    return <ZoneDashboard orders={visible} dsrs={dsrs} routes={routes} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Dashboard</h1>
        <Pill tone="gold">{user.role}</Pill>
      </div>

      <GlobalSearch orders={visible} dsrs={dsrs} routes={routes} />

      {/* Ordering is gated to Admin-opened dates — warn when none are open. */}
      {user.role === "Admin" && !availability.some((a) => a.date >= todayISO() && (a.ross > 0 || a.tetra > 0)) && (
        <Card className="border-gold bg-gold-bg/40">
          <p className="text-sm">
            <strong className="text-ink">No upcoming ordering dates are open.</strong>{" "}
            <span className="text-muted">New orders can&apos;t be placed until you open a date on </span>
            <Link href="/availability" className="font-semibold text-gold-dark underline">Availability</Link>.
          </p>
        </Card>
      )}

      {/* Admin sees everything waiting for their approval, before anything else. */}
      {user.role === "Admin" && (
        <ApprovalsCard users={users} orders={orders} commissions={commissions} />
      )}

      <Card>
        <DateRange value={range} onChange={setRange} />
      </Card>

      {user.role === "Admin" && (
        <AdminDashboard
          orders={scoped}
          db={{ users, dsrs, orders, commissions, statements, routes, availability, dsrVisits }}
          replaceAll={replaceAll}
          setOrders={setOrders}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin approvals card — everything waiting for the Admin, in one place
// ---------------------------------------------------------------------------

function ApprovalsCard({
  users,
  orders,
  commissions,
}: {
  users: import("@/lib/types").User[];
  orders: Order[];
  commissions: import("@/lib/types").CommissionRequest[];
}) {
  const pwReqs = users.filter((u) => u.pwRequest);
  const orderReqs = orders.filter((o) => o.request?.status === "open");
  const commReqs = commissions.filter((c) => c.status === "initiated");
  const payReqs = orders.flatMap((o) => o.payments.filter((p) => p.pendingApproval && !p.verified).map((p) => ({ o, p })));
  const total = pwReqs.length + orderReqs.length + commReqs.length + payReqs.length;

  if (total === 0) {
    return (
      <Card>
        <CardHeader title="Approvals waiting for you (0)" />
        <p className="text-sm text-muted">Nothing is waiting for your approval.</p>
      </Card>
    );
  }

  return (
    <Card className="border-gold bg-gold-bg/40">
      <CardHeader title={`Approvals waiting for you (${total})`} />
      <div className="space-y-2 text-sm">
        {payReqs.map(({ o, p }) => (
          <ApprovalRow
            key={`${o.id}-${p.pendingApproval!.on}`}
            label={`${o.name} — payment ${formatRWF(p.amt)} (missing ref)`}
            detail={`${p.flag ?? "Not in statements"} · from ${p.pendingApproval!.by}`}
            href="/verification"
            action="Review in Verification"
          />
        ))}
        {orderReqs.map((o) => (
          <ApprovalRow
            key={o.id}
            label={`${o.name} — ${o.request!.kind} request`}
            detail={o.request!.reason}
            href="/orders"
            action="Review in Orders"
          />
        ))}
        {commReqs.map((c) => (
          <ApprovalRow
            key={c.id}
            label={`${c.dsrName} — commission ${formatRWF(c.amount)}`}
            detail={`Initiated by ${c.by}`}
            href="/commission"
            action="Review in Commission"
          />
        ))}
        {pwReqs.map((u) => (
          <ApprovalRow
            key={u.email}
            label={`${u.name} — password change`}
            detail={u.email}
            href="/users"
            action="Review in Users"
          />
        ))}
      </div>
    </Card>
  );
}

function ApprovalRow({
  label,
  detail,
  href,
  action,
}: {
  label: string;
  detail: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper p-3">
      <div>
        <span className="font-semibold">{label}</span>{" "}
        <span className="text-muted">· {detail}</span>
      </div>
      <Link href={href} className="text-[0.78rem] font-semibold text-gold-dark underline">
        {action}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared metric helpers
// ---------------------------------------------------------------------------

function verifiedCollected(orders: Order[]): number {
  return orders.reduce(
    (s, o) => s + o.payments.filter((p) => p.verified).reduce((a, p) => a + p.amt, 0),
    0
  );
}
const isClosed = (o: Order) => o.status === "refunded" || o.status === "rejected";

function chicksSold(orders: Order[]): number {
  return orders.filter((o) => !isClosed(o)).reduce((s, o) => s + o.chicks, 0);
}
function outstanding(orders: Order[]): number {
  return orders
    .filter((o) => !isClosed(o))
    .reduce((s, o) => s + Math.max(0, balance(o)), 0);
}

function chicksPerDate(orders: Order[]) {
  const map = new Map<string, number>();
  for (const o of orders) {
    if (isClosed(o)) continue;
    map.set(o.date, (map.get(o.date) ?? 0) + toDeliver(o));
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, value]) => ({ label: formatDate(label), value }));
}

function salesPerProduct(orders: Order[]) {
  return PRODUCTS.map((p) => ({
    label: p,
    value: orders
      .filter((o) => o.product === p && !isClosed(o))
      .reduce((s, o) => s + orderTotal(o), 0),
  }));
}

function statusPie(orders: Order[]) {
  return [
    { label: "Pending", value: orders.filter((o) => o.status === "pending").length },
    { label: "Fulfilled", value: orders.filter((o) => o.status === "fulfilled").length },
    { label: "Refunded", value: orders.filter((o) => o.status === "refunded").length },
    { label: "Rejected", value: orders.filter((o) => o.status === "rejected").length },
  ];
}

function ProductSummary({ orders }: { orders: Order[] }) {
  return (
    <Card>
      <CardHeader title="Product summary" />
      <TableWrap>
        <thead>
          <tr>
            <Th>Product</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Chicks</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">Paid</Th>
            <Th className="text-right">Balance</Th>
          </tr>
        </thead>
        <tbody>
          {PRODUCTS.map((p) => {
            const list = orders.filter((o) => o.product === p);
            return (
              <tr key={p}>
                <Td>{p}</Td>
                <Td className="text-right">{list.length}</Td>
                <Td className="text-right">{list.reduce((s, o) => s + o.chicks, 0).toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(list.reduce((s, o) => s + orderTotal(o), 0))}</Td>
                <Td className="text-right">{formatRWF(list.reduce((s, o) => s + paidAmount(o), 0))}</Td>
                <Td className="text-right">{formatRWF(list.reduce((s, o) => s + balance(o), 0))}</Td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </Card>
  );
}

function DSRPerformance({ orders }: { orders: Order[] }) {
  const rows = commissionByDSR(orders);
  return (
    <Card>
      <CardHeader title="DSR performance" />
      <TableWrap>
        <thead>
          <tr>
            <Th>DSR</Th>
            <Th>District</Th>
            <Th className="text-right">Chicks</Th>
            <Th className="text-right">Commission</Th>
            <Th className="text-right">Given</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={5} text="No DSR activity yet." />
          ) : (
            rows.map((r) => (
              <tr key={r.dsrId}>
                <Td>
                  <Link href={`/dsrs/${r.dsrId}`} className="text-gold-dark underline underline-offset-2">
                    {r.dsrName}
                  </Link>
                </Td>
                <Td>{r.district}</Td>
                <Td className="text-right">{r.chicks.toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(r.amount)}</Td>
                <Td className="text-right">{formatRWF(r.paidAmount)}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Admin dashboard
// ---------------------------------------------------------------------------

function AdminDashboard({
  orders,
  db,
  replaceAll,
  setOrders,
}: {
  orders: Order[];
  db: import("@/lib/types").Database;
  replaceAll: (db: import("@/lib/types").Database) => Promise<void>;
  setOrders: (o: Order[]) => Promise<void>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const backupRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);

  const go = (tile: string) => router.push(`/orders?tile=${tile}`);

  async function onRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("Restore will REPLACE all current data. Continue?")) {
      if (backupRef.current) backupRef.current.value = "";
      return;
    }
    try {
      const restored = await readBackup(file);
      await replaceAll(restored);
      toast("Backup restored.");
    } catch {
      toast("Could not read that backup file.", "error");
    } finally {
      if (backupRef.current) backupRef.current.value = "";
    }
  }

  async function onImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importOrdersExcel(file);
      const byId = new Map(db.orders.map((o) => [o.id, o]));
      for (const o of imported) byId.set(o.id, o);
      await setOrders(Array.from(byId.values()));
      toast(`Imported ${imported.length} order(s).`);
    } catch {
      toast("Could not import that Excel file.", "error");
    } finally {
      if (excelRef.current) excelRef.current.value = "";
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Orders" value={String(orders.length)} icon="orders" onClick={() => go("all")} />
        <Kpi label="Pending" value={String(orders.filter((o) => o.status === "pending").length)} tone="gold" icon="pending" onClick={() => go("pending")} />
        <Kpi label="Fulfilled" value={String(orders.filter((o) => o.status === "fulfilled").length)} tone="green" icon="check" onClick={() => go("fulfilled")} />
        <Kpi label="Chicks sold" value={chicksSold(orders).toLocaleString()} icon="chicks" onClick={() => go("all")} />
        <Kpi label="Collected (verified)" value={formatRWF(verifiedCollected(orders))} tone="green" icon="money" onClick={() => go("collected")} />
        <Kpi label="Outstanding" value={formatRWF(outstanding(orders))} tone="red" icon="alert" onClick={() => go("outstanding")} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Orders by status" />
          <PieChartView data={statusPie(orders)} />
        </Card>
        <Card>
          <CardHeader title="Chicks per delivery date" />
          <LineChartView data={chicksPerDate(orders)} valueName="Chicks" />
        </Card>
        <Card>
          <CardHeader title="Sales per product" />
          <LineChartView data={salesPerProduct(orders)} color="#1565c0" valueName="RWF" />
        </Card>
      </div>

      <ProductSummary orders={orders} />
      <DSRPerformance orders={orders} />

      <Card>
        <CardHeader title="Data & backups" />
        <p className="mb-3 text-sm text-ink/60">
          Download a full JSON backup regularly (weekly recommended). You can
          also export/import all orders as Excel.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => downloadBackup(db)}>Download backup (JSON)</Button>
          <Button variant="ghost" onClick={() => backupRef.current?.click()}>Restore backup</Button>
          <input ref={backupRef} type="file" accept=".json" className="hidden" onChange={onRestore} />
          <Button variant="secondary" onClick={() => exportOrdersExcel(db.orders)}>Export orders (Excel)</Button>
          <Button variant="ghost" onClick={() => excelRef.current?.click()}>Import orders (Excel)</Button>
          <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onImportExcel} />
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Zone manager dashboard
// ---------------------------------------------------------------------------

function ZoneDashboard({
  orders,
  dsrs,
  routes,
}: {
  orders: Order[];
  dsrs: DSR[];
  routes: Route[];
}) {
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);

  const scoped = useMemo(
    () => orders.filter((o) => (!range.from && !range.to ? true : inRange(o.date, range))),
    [orders, range]
  );
  const active = useMemo(() => scoped.filter((o) => !isClosed(o)), [scoped]);

  const newOrders = active.filter((o) => o.status === "pending").length;
  const soldOrders = scoped.filter((o) => o.status === "fulfilled").length;
  const collected = verifiedCollected(active);
  const owed = outstanding(active);

  const statusCounts = {
    fulfilled: scoped.filter((o) => o.status === "fulfilled").length,
    pending: scoped.filter((o) => o.status === "pending").length,
    refunded: scoped.filter((o) => o.status === "refunded").length,
    rejected: scoped.filter((o) => o.status === "rejected").length,
  };
  const donut = [
    { label: "Fulfilled", value: statusCounts.fulfilled },
    { label: "Pending", value: statusCounts.pending },
    { label: "Refunded", value: statusCounts.refunded },
    { label: "Rejected", value: statusCounts.rejected },
  ];
  const totalForPct = scoped.length || 1;
  const pct = (v: number) => Math.round((v / totalForPct) * 100);

  // District rollup: orders, chicks, collected vs total value.
  const districtRows = useMemo(() => {
    const m = new Map<string, { orders: number; chicks: number; sales: number; total: number }>();
    for (const o of active) {
      const g = m.get(o.district) ?? { orders: 0, chicks: 0, sales: 0, total: 0 };
      g.orders += 1;
      g.chicks += o.chicks;
      g.sales += verifiedCollected([o]);
      g.total += orderTotal(o);
      m.set(o.district, g);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].chicks - a[1].chicks);
  }, [active]);

  // DSR rollup: commission plus what they actually sold.
  const dsrRows = useMemo(() => {
    const salesByDsr = new Map<string, number>();
    for (const o of active) if (o.dsrId) salesByDsr.set(o.dsrId, (salesByDsr.get(o.dsrId) ?? 0) + orderTotal(o));
    return commissionByDSR(active).map((r) => ({ ...r, sales: salesByDsr.get(r.dsrId) ?? 0 }));
  }, [active]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="section-heading text-lg">Dashboard</h1>
          <p className="text-sm text-muted">Welcome back! Here&apos;s what&apos;s happening with your operations today.</p>
        </div>
        <div className="w-full sm:max-w-md">
          <GlobalSearch orders={scoped} dsrs={dsrs} routes={routes} />
        </div>
      </div>

      <Card>
        <DateRange value={range} onChange={setRange} />
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ZoneTile tone="gold" icon={ZICON.orders} value={String(newOrders)} label="Orders (new)" sub="New orders received" />
        <ZoneTile tone="ink" icon={ZICON.sold} value={String(soldOrders)} label="Orders sold" sub="Total orders completed" />
        <ZoneTile tone="green" icon={ZICON.money} value={formatRWF(collected)} label="Collected (revenue)" sub="Total amount collected" />
        <ZoneTile tone="red" icon={ZICON.alert} value={formatRWF(owed)} label="Outstanding" sub="Amount outstanding" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle label="Chicks per delivery date" />
          <LineChartView data={chicksPerDate(active)} valueName="Chicks" />
        </Card>

        <Card>
          <SectionTitle label="Orders by status" />
          <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-2">
            <DonutChartView
              data={donut}
              colors={["#15803d", "#d4a017", "#2563eb", "#b91c1c"]}
              centerLabel={String(scoped.length)}
              centerSub="Orders"
            />
            <div className="space-y-2.5 text-sm">
              <LegendRow color="#15803d" label="Fulfilled" value={`${statusCounts.fulfilled} (${pct(statusCounts.fulfilled)}%)`} />
              <LegendRow color="#d4a017" label="Pending" value={`${statusCounts.pending} (${pct(statusCounts.pending)}%)`} />
              <LegendRow color="#2563eb" label="Refunded" value={`${statusCounts.refunded} (${pct(statusCounts.refunded)}%)`} />
              <LegendRow color="#b91c1c" label="Rejected" value={`${statusCounts.rejected} (${pct(statusCounts.rejected)}%)`} />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle label="District performance" />
        <TableWrap>
          <thead>
            <tr>
              <Th>District</Th><Th>Province</Th>
              <Th className="text-right">Orders</Th><Th className="text-right">Chicks</Th>
              <Th className="text-right">Sales (RWF)</Th><Th className="text-right">Total (RWF)</Th>
            </tr>
          </thead>
          <tbody>
            {districtRows.length === 0 ? (
              <EmptyRow colSpan={6} text="No results yet." />
            ) : districtRows.map(([d, g]) => (
              <tr key={d}>
                <Td className="font-medium">{d}</Td>
                <Td className="text-muted">{provinceOfDistrict(d) ?? "—"}</Td>
                <Td className="text-right">{g.orders}</Td>
                <Td className="text-right">{g.chicks.toLocaleString()}</Td>
                <Td className="text-right text-green">{formatRWF(g.sales)}</Td>
                <Td className="text-right">{formatRWF(g.total)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <SectionTitle label="DSR performance" />
        <TableWrap>
          <thead>
            <tr>
              <Th>DSR</Th><Th>District</Th>
              <Th className="text-right">Chicks</Th>
              <Th className="text-right">Commission (RWF)</Th>
              <Th className="text-right">Sales (RWF)</Th>
            </tr>
          </thead>
          <tbody>
            {dsrRows.length === 0 ? (
              <EmptyRow colSpan={5} text="No DSR activity yet." />
            ) : dsrRows.map((r) => (
              <tr key={r.dsrId}>
                <Td>
                  <Link href={`/dsrs/${r.dsrId}`} className="font-medium text-gold-dark underline underline-offset-2">{r.dsrName}</Link>
                </Td>
                <Td className="text-muted">{r.district}</Td>
                <Td className="text-right">{r.chicks.toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(r.amount)}</Td>
                <Td className="text-right">{formatRWF(r.sales)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

/** Small colour-chip section heading, e.g. "▪ DISTRICT PERFORMANCE". */
function SectionTitle({ label }: { label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-[3px] bg-gold" />
      <h3 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink">{label}</h3>
    </div>
  );
}

const ZTONE: Record<string, { chip: string; bar: string }> = {
  gold: { chip: "bg-gold-bg text-gold-dark", bar: "bg-gold" },
  ink: { chip: "bg-grey-bg text-ink", bar: "bg-ink" },
  green: { chip: "bg-green-bg text-green", bar: "bg-green" },
  red: { chip: "bg-red-bg text-red", bar: "bg-red" },
};

const ZICON = {
  orders: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1Z" /><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M9 11h6M9 15h4" /></svg>,
  sold: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5a2.5 2.5 0 0 1 5 0c0 3-5 2-5 5a2.5 2.5 0 0 0 5 0" /></svg>,
  money: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>,
  alert: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l9 16H3L12 4Z" /><path d="M12 10v4M12 17h.01" /></svg>,
};

function ZoneTile({
  tone, icon, value, label, sub,
}: { tone: keyof typeof ZTONE; icon: React.ReactNode; value: string; label: string; sub: string }) {
  const t = ZTONE[tone];
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper shadow-card">
      <div className="flex items-center gap-3.5 p-4">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${t.chip}`}>{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-[1.35rem] font-bold leading-tight text-ink tabular-nums">{value}</p>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
          <p className="text-[0.66rem] text-muted">{sub}</p>
        </div>
      </div>
      <div className={`h-1 w-full ${t.bar}`} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ross receiver dashboard
// ---------------------------------------------------------------------------

function RossDashboard({ orders, user }: { orders: Order[]; user: User }) {
  const router = useRouter();
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);
  const [region, setRegion] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const regions = useMemo(() => Array.from(new Set(orders.map((o) => o.province).filter(Boolean))).sort(), [orders]);

  const scoped = useMemo(() => {
    const inR = (d: string) => (!range.from && !range.to ? true : inRange(d, range));
    const q = query.trim().toLowerCase();
    return orders.filter((o) => inR(o.date) && (region === "all" || o.province === region) && (!q || o.name.toLowerCase().includes(q) || o.district.toLowerCase().includes(q)));
  }, [orders, range, region, query]);
  const active = useMemo(() => scoped.filter((o) => !isClosed(o)), [scoped]);

  const chicks = active.reduce((s, o) => s + o.chicks, 0);
  const amountReceived = verifiedCollected(active);
  const totalValue = active.reduce((s, o) => s + orderTotal(o), 0);
  const amountPending = active.reduce((s, o) => s + Math.max(0, balance(o)), 0);
  const pendingOrders = active.filter((o) => balance(o) > 0).length;
  const paymentRate = totalValue > 0 ? (amountReceived / totalValue) * 100 : 0;

  // Previous equal-length period for the trend badge.
  let deltaPct: number | null = null;
  if (range.from && range.to) {
    const from = new Date(range.from).getTime(), to = new Date(range.to).getTime();
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    const prevTo = from - 86_400_000, prevFrom = prevTo - (to - from);
    const prev = orders.filter((o) => (region === "all" || o.province === region) && !isClosed(o) && o.date >= iso(prevFrom) && o.date <= iso(prevTo));
    const prevVal = prev.reduce((s, o) => s + orderTotal(o), 0);
    if (prevVal > 0) deltaPct = ((totalValue - prevVal) / prevVal) * 100;
  }

  // Cumulative orders vs verified-paid orders over the delivery dates.
  const dates = Array.from(new Set(active.map((o) => o.date))).sort();
  const perDate = dates.map((d) => {
    const day = active.filter((o) => o.date === d);
    return { d, orders: day.length, paid: day.filter((o) => o.payments.some((p) => p.verified)).length };
  });
  const chartData = perDate.map((row, i) => {
    const upto = perDate.slice(0, i + 1);
    return { label: formatDate(row.d), orders: upto.reduce((a, x) => a + x.orders, 0), paid: upto.reduce((a, x) => a + x.paid, 0) };
  });

  const statusCounts = {
    pending: scoped.filter((o) => o.status === "pending").length,
    fulfilled: scoped.filter((o) => o.status === "fulfilled").length,
    refunded: scoped.filter((o) => o.status === "refunded").length,
    rejected: scoped.filter((o) => o.status === "rejected").length,
  };
  const donut = [
    { label: "Pending", value: statusCounts.pending },
    { label: "Fulfilled", value: statusCounts.fulfilled },
    { label: "Refunded", value: statusCounts.refunded },
    { label: "Rejected", value: statusCounts.rejected },
  ];
  const donutTotal = scoped.length || 1;
  const pct = (v: number) => ((v / donutTotal) * 100).toFixed(1);

  // Performance by district.
  const perf = useMemo(() => {
    const m = new Map<string, { orders: number; delivered: number; pending: number; amount: number }>();
    for (const o of active) {
      const g = m.get(o.district) ?? { orders: 0, delivered: 0, pending: 0, amount: 0 };
      g.orders += 1;
      if (o.deliverOk) g.delivered += o.chicks; else g.pending += o.chicks;
      g.amount += orderTotal(o);
      m.set(o.district, g);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].amount - a[1].amount).slice(0, 6);
  }, [active]);

  const recentOrders = useMemo(() => scoped.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 6), [scoped]);

  const verifiedPayments = active.flatMap((o) => o.payments).filter((p) => p.verified).length;
  const unverifiedPayments = active.flatMap((o) => o.payments).filter((p) => !p.verified).length;

  const statusTone = (s: Order["status"]) => (s === "fulfilled" ? "fulfilled" : s === "refunded" || s === "rejected" ? "red" : "gold");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="section-heading text-lg">Dashboard</h1>
        <p className="text-sm text-muted">Welcome back, {user.name} — here&apos;s your Ross 308 sales today.</p>
      </div>

      {/* Filter bar */}
      <div className="rounded-2xl border border-line bg-paper p-4 shadow-card">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.7fr_1fr_1fr_auto] lg:items-end">
          <FilterField label="Search">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Client or district…" className={CTRL} />
          </FilterField>
          <FilterField label="Delivery date range">
            <div className="flex items-center gap-1.5">
              <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={CTRL} />
              <span className="shrink-0 text-muted">–</span>
              <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className={CTRL} />
            </div>
          </FilterField>
          <FilterField label="Product">
            <div className={`${CTRL} flex items-center bg-cream/40 text-muted`}>Ross 308</div>
          </FilterField>
          <FilterField label="Region">
            <select value={region} onChange={(e) => setRegion(e.target.value)} className={CTRL}>
              <option value="all">All regions</option>
              {regions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </FilterField>
          <Button variant="ghost" className="h-10" onClick={() => { setRange(ALL_TIME); setRegion("all"); setQuery(""); }}>↺ Reset</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total orders" value={String(scoped.length)} tone="gold" icon="orders" sub="This period" onClick={() => router.push("/orders")} />
        <Kpi label="Total sales (chicks)" value={chicks.toLocaleString()} tone="green" icon="chicks" sub="Chicks ordered" />
        <Kpi label="Amount received" value={formatRWF(amountReceived)} tone="red" icon="money" sub="Paid amount" />
        <Kpi label="Amount pending" value={formatRWF(amountPending)} tone="blue" icon="alert" sub="Pending payments" />
        <Kpi label="Total value" value={formatRWF(totalValue)} tone="purple" icon="chart" sub="Total order value" />
      </div>

      {/* Orders over time + status donut */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Orders over time" />
          <MultiLineChartView data={chartData} series={[{ key: "orders", name: "Total Orders", color: "#d4a017" }, { key: "paid", name: "Payments Received", color: "#1c1a16" }]} />
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-cream/30 p-3 text-center sm:grid-cols-4">
            <Metric label="Total Orders" value={String(scoped.length)} />
            <Metric label="Chicks Sold" value={chicks.toLocaleString()} />
            <Metric label="Pending Orders" value={String(pendingOrders)} />
            <Metric label="Payment Rate" value={`${paymentRate.toFixed(1)}%`} tone="green" />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Orders by status" />
          <DonutChartView data={donut} colors={["#d4a017", "#15803d", "#2563eb", "#b91c1c"]} centerLabel={String(scoped.length)} centerSub="Total orders" />
          <div className="space-y-2 text-sm">
            <LegendRow color="#d4a017" label="Pending" value={`${statusCounts.pending} (${pct(statusCounts.pending)}%)`} />
            <LegendRow color="#15803d" label="Fulfilled" value={`${statusCounts.fulfilled} (${pct(statusCounts.fulfilled)}%)`} />
            <LegendRow color="#2563eb" label="Refunded" value={`${statusCounts.refunded} (${pct(statusCounts.refunded)}%)`} />
            <LegendRow color="#b91c1c" label="Rejected" value={`${statusCounts.rejected} (${pct(statusCounts.rejected)}%)`} />
          </div>
          {deltaPct !== null && (
            <div className="mt-3 rounded-xl border border-line bg-cream/30 p-3 text-center text-sm">
              <span className={deltaPct >= 0 ? "font-bold text-green" : "font-bold text-red"}>{deltaPct >= 0 ? "↗ +" : "↘ "}{deltaPct.toFixed(1)}%</span>
              <span className="text-muted"> vs previous period</span>
            </div>
          )}
        </Card>
      </div>

      {/* Recent performance + recent orders */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent performance (by district)" />
          <TableWrap>
            <thead><tr><Th>District</Th><Th className="text-right">Orders</Th><Th className="text-right">Delivered</Th><Th className="text-right">Pending</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>
              {perf.length === 0 ? <EmptyRow colSpan={5} text="No orders yet." /> : perf.map(([d, g]) => (
                <tr key={d}>
                  <Td className="font-medium">{d}</Td>
                  <Td className="text-right">{g.orders}</Td>
                  <Td className="text-right text-green">{g.delivered.toLocaleString()}</Td>
                  <Td className="text-right">{g.pending.toLocaleString()}</Td>
                  <Td className="text-right">{formatRWF(g.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>

        <Card>
          <CardHeader title="Recent orders" action={<Link href="/orders" className="text-sm font-semibold text-gold-dark">View all →</Link>} />
          <TableWrap>
            <thead><tr><Th>Delivery</Th><Th>Client</Th><Th className="text-right">Chicks</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
            <tbody>
              {recentOrders.length === 0 ? <EmptyRow colSpan={5} text="No orders yet." /> : recentOrders.map((o) => (
                <tr key={o.id}>
                  <Td>{formatDate(o.date)}</Td>
                  <Td>{o.name}</Td>
                  <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                  <Td className="text-right">{formatRWF(orderTotal(o))}</Td>
                  <Td><Pill tone={statusTone(o.status)}>{o.status}</Pill></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      {/* Payment progress + footer */}
      <Card>
        <CardHeader title="Payment progress" />
        <div className="flex flex-wrap items-center justify-around gap-3 py-2">
          <ProgressCircle tone="green" value={verifiedPayments} label="Verified" />
          <ProgressCircle tone="gold" value={unverifiedPayments} label="Pending" />
          <ProgressCircle tone="red" value={statusCounts.rejected} label="Rejected" />
          <ProgressCircle tone="blue" value={scoped.length} label="Total orders" />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-paper p-4 shadow-card text-sm sm:grid-cols-4">
        <FooterItem label="Today" value={formatDate(todayISO())} />
        <FooterItem label="Current time" value={now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
        <FooterItem label="Logged in as" value={user.name} />
        <FooterItem label="Region" value={region === "all" ? "All regions" : region} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment checker dashboard
// ---------------------------------------------------------------------------

function CheckerDashboard({ orders, statements, user }: { orders: Order[]; statements: BankStatement[]; user: User }) {
  const router = useRouter();
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);
  const [region, setRegion] = useState<string>("all");
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const product = user.role.includes("Tetra") ? "Tetra Super Harco" : "Ross 308";
  const regions = useMemo(() => Array.from(new Set(orders.map((o) => o.province).filter(Boolean))).sort(), [orders]);

  const scoped = useMemo(() => {
    const inR = (d: string) => (!range.from && !range.to ? true : inRange(d, range));
    return orders.filter((o) => inR(o.date) && (region === "all" || o.province === region));
  }, [orders, range, region]);
  const active = useMemo(() => scoped.filter((o) => o.status !== "rejected" && o.status !== "refunded"), [scoped]);

  const payments = active.flatMap((o) => o.payments);
  const verified = payments.filter((p) => p.verified);
  const unverified = payments.filter((p) => !p.verified);
  const amountReceived = verified.reduce((s, p) => s + p.amt, 0);
  const totalValue = active.reduce((s, o) => s + orderTotal(o), 0);
  const amountPending = active.reduce((s, o) => s + Math.max(0, balance(o)), 0);
  const receivedOrders = active.filter((o) => o.payments.some((p) => p.verified)).length;
  const pendingOrders = active.filter((o) => balance(o) > 0).length;
  const paymentRate = totalValue > 0 ? (amountReceived / totalValue) * 100 : 0;
  const rejected = scoped.filter((o) => o.status === "rejected").length;

  // Previous equal-length period, for the trend badge.
  let deltaPct: number | null = null;
  if (range.from && range.to) {
    const from = new Date(range.from).getTime(), to = new Date(range.to).getTime();
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    const prevTo = from - 86_400_000, prevFrom = prevTo - (to - from);
    const prev = orders.filter((o) => (region === "all" || o.province === region) && o.status !== "rejected" && o.status !== "refunded" && o.date >= iso(prevFrom) && o.date <= iso(prevTo));
    const prevVal = prev.reduce((s, o) => s + orderTotal(o), 0);
    if (prevVal > 0) deltaPct = ((totalValue - prevVal) / prevVal) * 100;
  }

  // Cumulative orders vs payments-received over the delivery dates in range.
  const dates = Array.from(new Set(active.map((o) => o.date))).sort();
  const perDate = dates.map((d) => {
    const day = active.filter((o) => o.date === d);
    return { d, orders: day.length, received: day.filter((o) => o.payments.some((p) => p.verified)).length };
  });
  const chartData = perDate.map((row, i) => {
    const upto = perDate.slice(0, i + 1);
    return { label: formatDate(row.d), orders: upto.reduce((a, x) => a + x.orders, 0), received: upto.reduce((a, x) => a + x.received, 0) };
  });

  const donut = [
    { label: "Received", value: amountReceived },
    { label: "Pending", value: amountPending },
  ];
  const donutTotal = amountReceived + amountPending;
  const pct = (v: number) => (donutTotal > 0 ? ((v / donutTotal) * 100).toFixed(1) : "0");

  const toReceive = active.filter((o) => balance(o) > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.plan - b.plan));
  const recentStatements = statements.slice().sort((a, b) => (a.uploadedOn < b.uploadedOn ? 1 : -1)).slice(0, 5);
  const statementsBalance = statements.reduce((s, st) => s + st.rows.reduce((a, r) => a + (Number(r.amt) || 0), 0), 0);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="rounded-2xl border border-line bg-paper p-4 shadow-card">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.7fr_1fr_1fr_auto] lg:items-end">
          <FilterField label="Delivery date range">
            <div className="flex items-center gap-1.5">
              <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={CTRL} />
              <span className="shrink-0 text-muted">–</span>
              <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className={CTRL} />
            </div>
          </FilterField>
          <FilterField label="Product">
            <div className={`${CTRL} flex items-center bg-cream/40 text-muted`}>{product}</div>
          </FilterField>
          <FilterField label="Region">
            <select value={region} onChange={(e) => setRegion(e.target.value)} className={CTRL}>
              <option value="all">All regions</option>
              {regions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </FilterField>
          <Button variant="ghost" className="h-10" onClick={() => { setRange(ALL_TIME); setRegion("all"); }}>↺ Reset</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total orders" value={String(scoped.length)} tone="gold" icon="orders" sub="This period" onClick={() => router.push("/orders")} />
        <Kpi label="Payments received" value={String(receivedOrders)} tone="green" icon="check" sub="Verified orders" onClick={() => router.push("/verification")} />
        <Kpi label="Amount received" value={formatRWF(amountReceived)} tone="red" icon="money" sub="Total received" />
        <Kpi label="Amount pending" value={formatRWF(amountPending)} tone="blue" icon="alert" sub="Total pending" />
        <Kpi label="Total value" value={formatRWF(totalValue)} tone="purple" icon="chart" sub="Total order value" />
      </div>

      {/* Overview + donut */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Orders overview" />
          <MultiLineChartView
            data={chartData}
            series={[{ key: "orders", name: "Total Orders", color: "#d4a017" }, { key: "received", name: "Payments Received", color: "#1c1a16" }]}
          />
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-cream/30 p-3 text-center sm:grid-cols-4">
            <Metric label="Total Orders" value={String(scoped.length)} />
            <Metric label="Payments Received" value={String(receivedOrders)} />
            <Metric label="Pending Orders" value={String(pendingOrders)} />
            <Metric label="Payment Rate" value={`${paymentRate.toFixed(1)}%`} tone="green" />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Collections" />
          <DonutChartView data={donut} colors={["#15803d", "#d4a017"]} centerLabel={formatRWF(totalValue)} centerSub="Total value" />
          <div className="space-y-2 text-sm">
            <LegendRow color="#15803d" label="Received" value={`${formatRWF(amountReceived)} (${pct(amountReceived)}%)`} />
            <LegendRow color="#d4a017" label="Pending" value={`${formatRWF(amountPending)} (${pct(amountPending)}%)`} />
          </div>
          {deltaPct !== null && (
            <div className="mt-3 rounded-xl border border-line bg-cream/30 p-3 text-center text-sm">
              <span className={deltaPct >= 0 ? "font-bold text-green" : "font-bold text-red"}>{deltaPct >= 0 ? "↗ +" : "↘ "}{deltaPct.toFixed(1)}%</span>
              <span className="text-muted"> vs previous period</span>
            </div>
          )}
        </Card>
      </div>

      {/* Payments to receive + right column */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Payments to receive" action={<Link href="/verification" className="text-sm font-semibold text-gold-dark">View all →</Link>} />
          <TableWrap>
            <thead>
              <tr><Th>Delivery date</Th><Th>Client</Th><Th>Product</Th><Th className="text-right">Pending amount</Th><Th>Status</Th><Th></Th></tr>
            </thead>
            <tbody>
              {toReceive.length === 0 ? (
                <EmptyRow colSpan={6} text="No pending payments — all collected." />
              ) : toReceive.slice(0, 12).map((o) => (
                <tr key={o.id}>
                  <Td>{formatDate(o.date)}</Td>
                  <Td>{o.name}</Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right font-semibold">{formatRWF(balance(o))}</Td>
                  <Td><Pill tone="gold">{paidAmount(o) > 0 ? "Partial" : "Pending"}</Pill></Td>
                  <Td className="text-right"><Link href="/verification" className="text-xs font-semibold text-gold-dark underline">View</Link></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-sm">Total pending amount: <strong className="text-red">{formatRWF(amountPending)}</strong></p>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Bank statements" action={<Link href="/verification" className="text-xs font-semibold text-gold-dark">View all</Link>} />
            <TableWrap>
              <thead><tr><Th>File</Th><Th>By</Th><Th className="text-right">Rows</Th></tr></thead>
              <tbody>
                {recentStatements.length === 0 ? (
                  <EmptyRow colSpan={3} text="No statements uploaded." />
                ) : recentStatements.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.fileName}</Td>
                    <Td className="text-muted">{s.uploadedBy}</Td>
                    <Td className="text-right">{s.rows.length.toLocaleString()}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <p className="mt-2 text-sm">Statement total: <strong className="text-green">{formatRWF(statementsBalance)}</strong></p>
          </Card>

          <Card>
            <CardHeader title="Verification progress" />
            <div className="flex items-center justify-around py-2">
              <ProgressCircle tone="green" value={verified.length} label="Verified" />
              <ProgressCircle tone="gold" value={unverified.length} label="Pending" />
              <ProgressCircle tone="red" value={rejected} label="Rejected" />
            </div>
          </Card>
        </div>
      </div>

      {/* Footer bar */}
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-paper p-4 shadow-card text-sm sm:grid-cols-4">
        <FooterItem label="Today" value={formatDate(todayISO())} />
        <FooterItem label="Current time" value={now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
        <FooterItem label="Logged in as" value={user.name} />
        <FooterItem label="Region" value={region === "all" ? "All regions" : region} />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div>
      <p className={`text-base font-bold ${tone === "green" ? "text-green" : "text-ink"}`}>{value}</p>
      <p className="text-[0.66rem] text-muted">{label}</p>
    </div>
  );
}

// Uniform filter-bar control + labelled field.
const CTRL = "h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-gold";
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
      {children}
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-muted">{label}</span>
      <span className="ml-auto font-medium text-ink">{value}</span>
    </div>
  );
}

function ProgressCircle({ tone, value, label }: { tone: "green" | "gold" | "red" | "blue"; value: number; label: string }) {
  const cls = tone === "green" ? "border-green/40 text-green" : tone === "gold" ? "border-gold text-gold-dark" : tone === "blue" ? "border-blue/40 text-blue" : "border-red/40 text-red";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className={`flex h-14 w-14 items-center justify-center rounded-full border-2 ${cls} text-lg font-bold`}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

function FooterItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}
