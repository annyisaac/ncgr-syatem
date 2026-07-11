"use client";

import { useMemo, useRef, useState } from "react";
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
import { LineChartView, PieChartView } from "@/components/charts/Charts";
import { GlobalSearch } from "@/components/sales/GlobalSearch";

import type { Order } from "@/lib/types";
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
  const { orders, replaceAll, setOrders, users, dsrs, commissions, statements, routes, availability } = useData();
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);

  const visible = useMemo(() => (user ? visibleOrders(orders, user) : []), [orders, user]);

  const scoped = useMemo(() => {
    if (!user) return [];
    const vis = visibleOrders(orders, user);
    if (!range.from && !range.to) return vis;
    return vis.filter((o) => inRange(o.date, range));
  }, [orders, user, range]);

  if (!user) return null;

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
          db={{ users, dsrs, orders, commissions, statements, routes, availability }}
          replaceAll={replaceAll}
          setOrders={setOrders}
        />
      )}
      {user.role === "Tetra Zone Manager" && <ZoneDashboard orders={scoped} zone={user.zone} />}
      {user.role === "Ross Order Receiver" && <RossDashboard orders={scoped} />}
      {(user.role === "Tetra Payment Checker" || user.role === "Ross Payment Checker") && (
        <CheckerDashboard orders={scoped} />
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
  const total = pwReqs.length + orderReqs.length + commReqs.length;

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

function DistrictPerformance({ orders }: { orders: Order[] }) {
  const map = new Map<string, { chicks: number; total: number; count: number }>();
  for (const o of orders) {
    const g = map.get(o.district) ?? { chicks: 0, total: 0, count: 0 };
    g.chicks += o.chicks;
    g.total += orderTotal(o);
    g.count += 1;
    map.set(o.district, g);
  }
  const rows = Array.from(map.entries()).sort((a, b) => b[1].chicks - a[1].chicks);
  return (
    <Card>
      <CardHeader title="District performance" />
      <TableWrap>
        <thead>
          <tr>
            <Th>District</Th>
            <Th>Province</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Chicks</Th>
            <Th className="text-right">Total</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={5} text="No orders yet." />
          ) : (
            rows.map(([district, g]) => (
              <tr key={district}>
                <Td>{district}</Td>
                <Td>{provinceOfDistrict(district) ?? "—"}</Td>
                <Td className="text-right">{g.count}</Td>
                <Td className="text-right">{g.chicks.toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(g.total)}</Td>
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
        <Kpi label="Orders" value={String(orders.length)} onClick={() => go("all")} />
        <Kpi label="Pending" value={String(orders.filter((o) => o.status === "pending").length)} tone="gold" onClick={() => go("pending")} />
        <Kpi label="Fulfilled" value={String(orders.filter((o) => o.status === "fulfilled").length)} tone="green" onClick={() => go("fulfilled")} />
        <Kpi label="Chicks sold" value={chicksSold(orders).toLocaleString()} onClick={() => go("all")} />
        <Kpi label="Collected (verified)" value={formatRWF(verifiedCollected(orders))} tone="green" onClick={() => go("collected")} />
        <Kpi label="Outstanding" value={formatRWF(outstanding(orders))} tone="red" onClick={() => go("outstanding")} />
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

function ZoneDashboard({ orders, zone }: { orders: Order[]; zone?: string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={`Orders (${zone ?? "zone"})`} value={String(orders.length)} />
        <Kpi label="Chicks sold" value={chicksSold(orders).toLocaleString()} />
        <Kpi label="Collected (verified)" value={formatRWF(verifiedCollected(orders))} />
        <Kpi label="Outstanding" value={formatRWF(outstanding(orders))} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Chicks per delivery date" />
          <LineChartView data={chicksPerDate(orders)} valueName="Chicks" />
        </Card>
        <Card>
          <CardHeader title="Orders by status" />
          <PieChartView data={statusPie(orders)} />
        </Card>
      </div>
      <DistrictPerformance orders={orders} />
      <DSRPerformance orders={orders} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Ross receiver dashboard
// ---------------------------------------------------------------------------

function RossDashboard({ orders }: { orders: Order[] }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Ross orders" value={String(orders.length)} />
        <Kpi label="Chicks sold" value={chicksSold(orders).toLocaleString()} />
        <Kpi label="Collected (verified)" value={formatRWF(verifiedCollected(orders))} />
        <Kpi label="Outstanding" value={formatRWF(outstanding(orders))} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Chicks per delivery date" />
          <LineChartView data={chicksPerDate(orders)} valueName="Chicks" />
        </Card>
        <Card>
          <CardHeader title="Orders by status" />
          <PieChartView data={statusPie(orders)} />
        </Card>
      </div>
      <DistrictPerformance orders={orders} />
      <DSRPerformance orders={orders} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Payment checker dashboard
// ---------------------------------------------------------------------------

function CheckerDashboard({ orders }: { orders: Order[] }) {
  const confirmed = orders.filter((o) => o.confirmedOk);
  const allPayments = confirmed.flatMap((o) => o.payments);
  const verified = allPayments.filter((p) => p.verified);
  const unverified = allPayments.filter((p) => !p.verified);

  // Per delivery-date table.
  const map = new Map<string, { orders: number; verified: number; unverified: number }>();
  for (const o of confirmed) {
    const g = map.get(o.date) ?? { orders: 0, verified: 0, unverified: 0 };
    g.orders += 1;
    g.verified += o.payments.filter((p) => p.verified).length;
    g.unverified += o.payments.filter((p) => !p.verified).length;
    map.set(o.date, g);
  }
  const rows = Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Confirmed orders" value={String(confirmed.length)} />
        <Kpi label="Payments verified" value={String(verified.length)} />
        <Kpi label="Payments unverified" value={String(unverified.length)} />
        <Kpi label="Amount verified" value={formatRWF(verified.reduce((s, p) => s + p.amt, 0))} />
      </div>
      <Card>
        <CardHeader title="Verification by delivery date" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Delivery date</Th>
              <Th className="text-right">Orders</Th>
              <Th className="text-right">Verified</Th>
              <Th className="text-right">Unverified</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={4} text="No confirmed orders yet." />
            ) : (
              rows.map(([date, g]) => (
                <tr key={date}>
                  <Td>{formatDate(date)}</Td>
                  <Td className="text-right">{g.orders}</Td>
                  <Td className="text-right">{g.verified}</Td>
                  <Td className="text-right">{g.unverified}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}
