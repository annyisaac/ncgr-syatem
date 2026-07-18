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
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { LineChartView, MultiLineChartView } from "@/components/charts/Charts";

import type { Order, BankStatement, User, Availability } from "@/lib/types";
import { PRODUCTS } from "@/lib/types";
import { availableFor, balance, orderTotal, paidAmount, toDeliver } from "@/lib/types";
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

  const visible = useMemo(() => (user ? visibleOrders(orders, user) : []), [orders, user]);

  if (!user) return null;

  // Each role gets a dedicated, self-contained dashboard sharing one look.
  if (user.role === "Tetra Payment Checker" || user.role === "Ross Payment Checker") {
    return <CheckerDashboard orders={visible} statements={statements} user={user} />;
  }
  if (user.role === "Ross Order Receiver") {
    return <RossDashboard user={user} orders={visible} availability={availability} />;
  }
  if (user.role === "Tetra Zone Manager") {
    return <ZoneDashboard user={user} orders={visible} availability={availability} />;
  }
  if (user.role === "Admin") {
    return (
      <AdminDashboard
        user={user}
        orders={visible}
        db={{ users, dsrs, orders, commissions, statements, routes, availability, dsrVisits }}
        replaceAll={replaceAll}
        setOrders={setOrders}
      />
    );
  }

  // Any other role that lands here has its work on its department pages.
  const firstName = user.name.split(" ")[0] || user.name;
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-ink">
        Hey {firstName} — <span className="font-normal text-muted">welcome back</span>
      </h1>
      <Card>
        <p className="text-sm text-muted">Use the menu to open your department&apos;s pages.</p>
      </Card>
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
  user,
  orders,
  db,
  replaceAll,
  setOrders,
}: {
  user: User;
  orders: Order[];
  db: import("@/lib/types").Database;
  replaceAll: (db: import("@/lib/types").Database) => Promise<void>;
  setOrders: (o: Order[]) => Promise<void>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const backupRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);

  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const today = todayISO();
  const range = useMemo(() => presetToRange(preset, custom, today), [preset, custom, today]);
  const scoped = useMemo(
    () => orders.filter((o) => (!range.from && !range.to ? true : inRange(o.date, range))),
    [orders, range]
  );
  const active = useMemo(() => scoped.filter((o) => !isClosed(o)), [scoped]);

  const pending = scoped.filter((o) => o.status === "pending").length;
  const fulfilled = scoped.filter((o) => o.status === "fulfilled").length;
  const refunded = scoped.filter((o) => o.status === "refunded").length;
  const rejected = scoped.filter((o) => o.status === "rejected").length;
  const collected = verifiedCollected(active);
  const owed = outstanding(active);
  const sold = chicksSold(scoped);
  const statusMax = Math.max(pending, fulfilled, refunded, rejected, 1);

  const dates = useMemo(() => Array.from(new Set(scoped.map((o) => o.date))).sort(), [scoped]);
  const ordersGrowth = useMemo(() => dates.map((d) => {
    const upto = scoped.filter((o) => o.date <= d);
    return {
      label: formatDate(d),
      pending: upto.filter((o) => o.status === "pending" && !o.confirmedOk).length,
      inprogress: upto.filter((o) => o.status === "pending" && o.confirmedOk).length,
      completed: upto.filter((o) => o.status === "fulfilled").length,
    };
  }), [dates, scoped]);
  const productRows = salesPerProduct(scoped);
  const productMax = Math.max(...productRows.map((r) => r.value), 1);

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
    <div className="space-y-5">
      <DashboardHeader user={user} subtitle="here's the whole operation" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />

      {/* Ordering is gated to Admin-opened dates — warn when none are open. */}
      {!db.availability.some((a) => a.date >= today && (a.ross > 0 || a.tetra > 0)) && (
        <Card className="border-gold bg-gold-bg/40">
          <p className="text-sm">
            <strong className="text-ink">No upcoming ordering dates are open.</strong>{" "}
            <span className="text-muted">New orders can&apos;t be placed until you open a date on </span>
            <Link href="/availability" className="font-semibold text-gold-dark underline">Availability</Link>.
          </p>
        </Card>
      )}

      <ApprovalsCard users={db.users} orders={db.orders} commissions={db.commissions} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Orders" value={String(scoped.length)} onClick={() => go("all")} />
        <StatTile label="Pending" value={String(pending)} onClick={() => go("pending")} />
        <StatTile label="Fulfilled" value={String(fulfilled)} onClick={() => go("fulfilled")} />
        <StatTile label="Chicks sold" value={sold.toLocaleString()} onClick={() => go("all")} />
        <StatTile label="Collected" value={formatRWF(collected)} onClick={() => go("collected")} />
        <StatTile label="Outstanding" value={formatRWF(owed)} onClick={() => go("outstanding")} />
      </div>

      <AvailabilityPanel availability={db.availability} orders={db.orders} focus="both" />

      {/* Orders growth | orders-by-status metrics */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle label="Orders growth" />
          <MultiLineChartView
            data={ordersGrowth}
            series={[
              { key: "pending", name: "Pending", color: "#d4a017" },
              { key: "inprogress", name: "In progress", color: "#2563eb" },
              { key: "completed", name: "Completed", color: "#15803d" },
            ]}
          />
        </Card>
        <Card>
          <SectionTitle label="Orders by status" />
          <div className="space-y-4 pt-1">
            <MetricBar label="Pending" display={String(pending)} value={pending} max={statusMax} color="#d4a017" />
            <MetricBar label="Fulfilled" display={String(fulfilled)} value={fulfilled} max={statusMax} color="#15803d" />
            <MetricBar label="Refunded" display={String(refunded)} value={refunded} max={statusMax} color="#2563eb" />
            <MetricBar label="Rejected" display={String(rejected)} value={rejected} max={statusMax} color="#b91c1c" />
          </div>
        </Card>
      </div>

      {/* Chicks per date | sales-per-product metrics */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle label="Chicks per delivery date" />
          <LineChartView data={chicksPerDate(scoped)} valueName="Chicks" />
        </Card>
        <Card>
          <SectionTitle label="Sales per product" />
          <div className="space-y-4 pt-1">
            {productRows.map((r) => (
              <MetricBar key={r.label} label={r.label} display={formatRWF(r.value)} value={r.value} max={productMax} color="#d97706" />
            ))}
          </div>
        </Card>
      </div>

      <ProductSummary orders={scoped} />
      <DSRPerformance orders={scoped} />

      <Card>
        <SectionTitle label="Data & backups" />
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sales overview (Zone Manager & Ross): greeting + period picker,
// stat strip, availability cards, then chart-left / metric-bars-right rows.
// ---------------------------------------------------------------------------

type PeriodPreset = "today" | "week" | "month" | "year" | "all" | "custom";

const PERIODS: { value: PeriodPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Presets span the WHOLE calendar period (month = 1st..last day), not
 * "start..today": orders are placed for future delivery dates, and cutting at
 * today would hide everything still coming.
 */
function presetToRange(p: PeriodPreset, custom: DateRangeValue, today: string): DateRangeValue {
  const d = new Date(`${today}T00:00:00`);
  switch (p) {
    case "custom": return custom;
    case "all": return ALL_TIME;
    case "today": return { from: today, to: today };
    case "week": {
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: isoDay(monday), to: isoDay(sunday) };
    }
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
    case "year":
      return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
  }
}

/** Slim stat tile: tiny uppercase label over a big number; clickable if onClick. */
function StatTile({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const cls = "rounded-xl border border-line bg-paper px-4 py-3 shadow-card";
  const body = (
    <>
      <p className="text-[0.6rem] font-bold uppercase tracking-[0.09em] text-muted">{label}</p>
      <p className="mt-1 truncate text-[1.3rem] font-bold leading-tight text-ink tabular-nums">{value}</p>
    </>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} className={`${cls} text-left transition hover:border-gold`}>{body}</button>;
  }
  return <div className={cls}>{body}</div>;
}

/** Label + number over a thin colored bar (width = value vs the card's max). */
function MetricBar({ label, display, value, max, color }: {
  label: string; display: string; value: number; max: number; color: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[0.8rem]">
        <span className="text-ink">{label}</span>
        <span className="font-semibold tabular-nums text-ink">{display}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-grey-bg">
        <div className="h-full rounded-full" style={{ width: `${Math.max(value > 0 ? 3 : 0, pct)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/**
 * Shared dashboard header: "Hey {name} — {subtitle}", a bare search pill in the
 * middle (Enter → Orders search), and the period picker on the right. Every
 * role's dashboard opens with this, so they all read the same.
 */
function DashboardHeader({
  user,
  subtitle,
  preset,
  setPreset,
  custom,
  setCustom,
}: {
  user: User;
  subtitle: string;
  preset: PeriodPreset;
  setPreset: (p: PeriodPreset) => void;
  custom: DateRangeValue;
  setCustom: (v: DateRangeValue) => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const firstName = user.name.split(" ")[0] || user.name;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-lg font-bold text-ink">
        Hey {firstName} — <span className="font-normal text-muted">{subtitle}</span>
      </h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const s = q.trim();
          if (s) router.push(`/orders?q=${encodeURIComponent(s)}`);
        }}
        className="order-last relative w-full min-w-0 lg:order-none lg:mx-auto lg:w-96"
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3.5 3.5" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search orders — client, phone…"
          aria-label="Search orders"
          className="h-10 w-full rounded-full border border-line bg-paper pl-10 pr-4 text-sm text-ink outline-none transition focus:border-gold"
        />
      </form>
      <div className="ml-auto flex flex-wrap items-center gap-2 lg:ml-0">
        <select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} className={`${CTRL} w-auto`}>
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className={`${CTRL} w-auto`} />
            <span className="text-muted">–</span>
            <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className={`${CTRL} w-auto`} />
          </div>
        )}
      </div>
    </div>
  );
}

function SalesOverview({
  user,
  orders,
  availability,
  focus,
  Tail,
}: {
  user: User;
  orders: Order[];
  availability: Availability[];
  focus: "Ross 308" | "Tetra Super Harco";
  Tail: React.ComponentType<{ active: Order[]; scoped: Order[] }>;
}) {
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const today = todayISO();
  const range = useMemo(() => presetToRange(preset, custom, today), [preset, custom, today]);

  const scoped = useMemo(
    () => orders.filter((o) => (!range.from && !range.to ? true : inRange(o.date, range))),
    [orders, range]
  );
  const active = useMemo(() => scoped.filter((o) => !isClosed(o)), [scoped]);

  const chicks = active.reduce((s, o) => s + o.chicks, 0);
  const totalValue = active.reduce((s, o) => s + orderTotal(o), 0);
  const collected = verifiedCollected(active);
  const owed = outstanding(active);
  const recordedPaid = scoped.reduce((s, o) => s + paidAmount(o), 0);

  const pendingNew = scoped.filter((o) => o.status === "pending" && !o.confirmedOk).length;
  const inProgress = scoped.filter((o) => o.status === "pending" && o.confirmedOk).length;
  const completed = scoped.filter((o) => o.status === "fulfilled").length;

  // Cumulative growth over the period's delivery dates.
  const dates = useMemo(() => Array.from(new Set(scoped.map((o) => o.date))).sort(), [scoped]);
  const ordersGrowth = useMemo(() => dates.map((d) => {
    const upto = scoped.filter((o) => o.date <= d);
    return {
      label: formatDate(d),
      pending: upto.filter((o) => o.status === "pending" && !o.confirmedOk).length,
      inprogress: upto.filter((o) => o.status === "pending" && o.confirmedOk).length,
      completed: upto.filter((o) => o.status === "fulfilled").length,
    };
  }), [dates, scoped]);
  const salesGrowth = useMemo(() => dates.map((d) => ({
    label: formatDate(d),
    value: active.filter((o) => o.date <= d).reduce((s, o) => s + o.chicks, 0),
  })), [dates, active]);
  const revenueGrowth = useMemo(() => dates.map((d) => ({
    label: formatDate(d),
    value: scoped.filter((o) => o.date <= d).reduce((s, o) => s + paidAmount(o), 0),
  })), [dates, scoped]);

  const chicksToday = active.filter((o) => o.date === today).reduce((s, o) => s + o.chicks, 0);
  const ordersMax = Math.max(pendingNew, inProgress, completed, scoped.length, 1);
  const moneyMax = Math.max(recordedPaid, collected, owed, 1);

  return (
    <div className="space-y-5">
      <DashboardHeader user={user} subtitle="here's your sales overview" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />

      {/* Slim stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Total orders" value={String(scoped.length)} />
        <StatTile label="Total chicks" value={chicks.toLocaleString()} />
        <StatTile label="Total value" value={formatRWF(totalValue)} />
        <StatTile label="Collected (verified)" value={formatRWF(collected)} />
        <StatTile label="Pending orders" value={String(pendingNew + inProgress)} />
      </div>

      <AvailabilityPanel availability={availability} orders={orders} focus={focus} />

      {/* Orders growth | orders metrics */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle label="Orders growth" />
          <MultiLineChartView
            data={ordersGrowth}
            series={[
              { key: "pending", name: "Pending", color: "#d4a017" },
              { key: "inprogress", name: "In progress", color: "#2563eb" },
              { key: "completed", name: "Completed", color: "#15803d" },
            ]}
          />
        </Card>
        <Card>
          <SectionTitle label="Orders metrics" />
          <div className="space-y-4 pt-1">
            <MetricBar label="Pending (in period)" display={String(pendingNew)} value={pendingNew} max={ordersMax} color="#d4a017" />
            <MetricBar label="In progress (in period)" display={String(inProgress)} value={inProgress} max={ordersMax} color="#2563eb" />
            <MetricBar label="Completed (in period)" display={String(completed)} value={completed} max={ordersMax} color="#15803d" />
            <MetricBar label="Total orders" display={String(scoped.length)} value={scoped.length} max={ordersMax} color="#7c3aed" />
          </div>
        </Card>
      </div>

      {/* Sales growth | sales metrics */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle label="Sales growth (chicks)" />
          <LineChartView data={salesGrowth} color="#15803d" valueName="Chicks" />
        </Card>
        <Card>
          <SectionTitle label="Sales metrics" />
          <div className="space-y-4 pt-1">
            <MetricBar label="Chicks in period" display={chicks.toLocaleString()} value={chicks} max={Math.max(chicks, 1)} color="#15803d" />
            <MetricBar label="Chicks for today" display={chicksToday.toLocaleString()} value={chicksToday} max={Math.max(chicks, 1)} color="#d4a017" />
          </div>
        </Card>
      </div>

      {/* Revenue | revenue metrics */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle label="Revenue (amount paid)" />
          <LineChartView data={revenueGrowth} color="#d97706" valueName="RWF" />
        </Card>
        <Card>
          <SectionTitle label="Revenue metrics" />
          <div className="space-y-4 pt-1">
            <MetricBar label="Total paid (recorded)" display={formatRWF(recordedPaid)} value={recordedPaid} max={moneyMax} color="#d97706" />
            <MetricBar label="Collected (verified)" display={formatRWF(collected)} value={collected} max={moneyMax} color="#15803d" />
            <MetricBar label="Outstanding" display={formatRWF(owed)} value={owed} max={moneyMax} color="#b91c1c" />
          </div>
        </Card>
      </div>

      <Tail active={active} scoped={scoped} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone manager dashboard
// ---------------------------------------------------------------------------

function ZoneDashboard(props: {
  user: User;
  orders: Order[];
  availability: Availability[];
}) {
  return <SalesOverview {...props} focus="Tetra Super Harco" Tail={ZoneTail} />;
}

/** Zone tail: district + DSR performance tables under the shared overview. */
function ZoneTail({ active }: { active: Order[]; scoped: Order[] }) {
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
    <>
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
    </>
  );
}

/** Small colour-chip section heading, with an optional right-side action. */
function SectionTitle({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-[3px] bg-gold" />
        <h3 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink">{label}</h3>
      </div>
      {action}
    </div>
  );
}

/**
 * Read-only ordering-availability panel — the upcoming open delivery dates and
 * how many chicks are still available. Shown on the sales dashboards so the
 * numbers live where people work; Admin still SETS them on /availability.
 * `focus` picks which product columns to show.
 */
function AvailabilityPanel({
  availability,
  orders,
  focus = "both",
}: {
  availability: Availability[];
  orders: Order[];
  focus?: "Ross 308" | "Tetra Super Harco" | "both";
}) {
  const today = todayISO();
  const rows = availability
    .filter((a) => a.date >= today && (a.ross > 0 || a.tetra > 0))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 6);
  const showRoss = focus === "both" || focus === "Ross 308";
  const showTetra = focus === "both" || focus === "Tetra Super Harco";

  const daysUntil = (d: string) => {
    const diff = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86_400_000);
    return diff <= 0 ? "Today" : diff === 1 ? "Tomorrow" : `In ${diff} days`;
  };

  return (
    <Card>
      <SectionTitle label="Ordering availability" />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No upcoming ordering dates are open.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((a) => {
            // One meter per focused product with capacity opened on this date.
            const meters: { name: string; cap: number; left: number }[] = [];
            if (showRoss && a.ross > 0) meters.push({ name: "Ross 308", cap: a.ross, left: availableFor(a, "Ross 308", orders) });
            if (showTetra && a.tetra > 0) meters.push({ name: "Tetra Super Harco", cap: a.tetra, left: availableFor(a, "Tetra Super Harco", orders) });
            if (meters.length === 0) return null;

            const full = meters.every((m) => m.left <= 0);
            const filling = !full && meters.some((m) => m.cap > 0 && (m.cap - m.left) / m.cap >= 0.7);
            const badge = full
              ? { text: "Full", cls: "bg-red-bg text-red" }
              : filling
                ? { text: "Filling", cls: "bg-gold-bg text-gold-dark" }
                : { text: "Open", cls: "bg-green-bg text-green" };

            return (
              <div key={a.id} className="rounded-2xl border border-line bg-paper p-4 shadow-card">
                <div className="mb-2.5 flex items-baseline justify-between gap-2">
                  <div>
                    <p className="text-[0.98rem] font-bold leading-tight text-ink">{formatDate(a.date)}</p>
                    <p className="text-[0.7rem] text-muted">{daysUntil(a.date)}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide ${badge.cls}`}>{badge.text}</span>
                </div>
                {meters.map((m) => {
                  const bookedPct = Math.min(100, Math.max(0, Math.round(((m.cap - m.left) / m.cap) * 100)));
                  const bar = m.left <= 0 ? "bg-red" : bookedPct >= 70 ? "bg-gold" : "bg-green";
                  return (
                    <div key={m.name} className="mt-2.5">
                      <div className="mb-1 flex items-center justify-between text-[0.76rem]">
                        <span className="font-semibold text-ink">{m.name}</span>
                        <span className={`tabular-nums ${m.left <= 0 ? "font-bold text-red" : "text-muted"}`}>
                          {m.left <= 0 ? "Sold out" : `${m.left.toLocaleString()} left`}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-grey-bg">
                        <div className={`h-full rounded-full ${bar}`} style={{ width: `${bookedPct}%` }} />
                      </div>
                      <p className="mt-1 text-right text-[0.64rem] text-muted">
                        {(m.cap - m.left).toLocaleString()} of {m.cap.toLocaleString()} booked
                      </p>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ross receiver dashboard
// ---------------------------------------------------------------------------

function RossDashboard(props: {
  user: User;
  orders: Order[];
  availability: Availability[];
}) {
  return <SalesOverview {...props} focus="Ross 308" Tail={RossTail} />;
}

/** Ross tail: district performance + recent orders under the shared overview. */
function RossTail({ active, scoped }: { active: Order[]; scoped: Order[] }) {
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

  const recentOrders = useMemo(
    () => scoped.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8),
    [scoped]
  );
  const statusTone = (s: Order["status"]) => (s === "fulfilled" ? "fulfilled" : s === "refunded" || s === "rejected" ? "red" : "gold");

  return (
    <>
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
        <CardHeader title="Recent orders" action={<Link href="/orders" className="text-sm font-semibold text-gold-dark">View all →</Link>} />
        <TableWrap>
          <thead><tr><Th>Delivery</Th><Th>Client</Th><Th>District</Th><Th className="text-right">Chicks</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
          <tbody>
            {recentOrders.length === 0 ? <EmptyRow colSpan={6} text="No orders yet." /> : recentOrders.map((o) => (
              <tr key={o.id}>
                <Td>{formatDate(o.date)}</Td>
                <Td>{o.name}</Td>
                <Td className="text-muted">{o.district}</Td>
                <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(orderTotal(o))}</Td>
                <Td><Pill tone={statusTone(o.status)}>{o.status}</Pill></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Payment checker dashboard
// ---------------------------------------------------------------------------

function CheckerDashboard({ orders, statements, user }: { orders: Order[]; statements: BankStatement[]; user: User }) {
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const today = todayISO();
  const range = useMemo(() => presetToRange(preset, custom, today), [preset, custom, today]);
  const product = user.role.includes("Tetra") ? "Tetra Super Harco" : "Ross 308";

  const scoped = useMemo(
    () => orders.filter((o) => (!range.from && !range.to ? true : inRange(o.date, range))),
    [orders, range]
  );
  const active = useMemo(() => scoped.filter((o) => o.status !== "rejected" && o.status !== "refunded"), [scoped]);

  const paymentsAll = active.flatMap((o) => o.payments);
  const verified = paymentsAll.filter((p) => p.verified);
  const unverified = paymentsAll.filter((p) => !p.verified);
  const amountReceived = verified.reduce((s, p) => s + p.amt, 0);
  const totalValue = active.reduce((s, o) => s + orderTotal(o), 0);
  const amountPending = active.reduce((s, o) => s + Math.max(0, balance(o)), 0);
  const receivedOrders = active.filter((o) => o.payments.some((p) => p.verified)).length;
  const paymentRate = totalValue > 0 ? (amountReceived / totalValue) * 100 : 0;
  const rejected = scoped.filter((o) => o.status === "rejected").length;

  const dates = useMemo(() => Array.from(new Set(active.map((o) => o.date))).sort(), [active]);
  const collectionsGrowth = useMemo(() => dates.map((d) => ({
    label: formatDate(d),
    value: active
      .filter((o) => o.date <= d)
      .reduce((s, o) => s + o.payments.filter((p) => p.verified).reduce((a, p) => a + p.amt, 0), 0),
  })), [dates, active]);

  const toReceive = useMemo(
    () => active.filter((o) => balance(o) > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.plan - b.plan)),
    [active]
  );
  const recentStatements = useMemo(() => statements.slice().sort((a, b) => (a.uploadedOn < b.uploadedOn ? 1 : -1)).slice(0, 6), [statements]);
  const statementsBalance = statements.reduce((s, st) => s + st.rows.reduce((a, r) => a + (Number(r.amt) || 0), 0), 0);

  const moneyMax = Math.max(totalValue, amountReceived, amountPending, 1);
  const payMax = Math.max(paymentsAll.length, 1);

  return (
    <div className="space-y-5">
      <DashboardHeader user={user} subtitle={`here's your ${product} payments overview`} preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Total orders" value={String(scoped.length)} />
        <StatTile label="Paid orders" value={String(receivedOrders)} />
        <StatTile label="Amount received" value={formatRWF(amountReceived)} />
        <StatTile label="Amount pending" value={formatRWF(amountPending)} />
        <StatTile label="Total value" value={formatRWF(totalValue)} />
      </div>

      {/* Collections growth | collections metrics */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle label="Collections (verified, cumulative)" />
          <LineChartView data={collectionsGrowth} color="#15803d" valueName="RWF" />
        </Card>
        <Card>
          <SectionTitle label="Collections metrics" />
          <div className="space-y-4 pt-1">
            <MetricBar label="Amount received" display={formatRWF(amountReceived)} value={amountReceived} max={moneyMax} color="#15803d" />
            <MetricBar label="Amount pending" display={formatRWF(amountPending)} value={amountPending} max={moneyMax} color="#d4a017" />
            <MetricBar label="Payment rate" display={`${paymentRate.toFixed(1)}%`} value={paymentRate} max={100} color="#2563eb" />
          </div>
        </Card>
      </div>

      {/* Payments to receive | verification metrics */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle label="Payments to receive" action={<Link href="/verification" className="text-sm font-semibold text-gold-dark">View all →</Link>} />
          <TableWrap>
            <thead>
              <tr><Th>Delivery date</Th><Th>Client</Th><Th>Product</Th><Th className="text-right">Pending amount</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {toReceive.length === 0 ? (
                <EmptyRow colSpan={5} text="No pending payments — all collected." />
              ) : toReceive.slice(0, 10).map((o) => (
                <tr key={o.id}>
                  <Td>{formatDate(o.date)}</Td>
                  <Td>{o.name}</Td>
                  <Td className="text-muted">{o.product}</Td>
                  <Td className="text-right font-semibold">{formatRWF(balance(o))}</Td>
                  <Td><Pill tone="gold">{paidAmount(o) > 0 ? "Partial" : "Pending"}</Pill></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-sm">Total pending amount: <strong className="text-red">{formatRWF(amountPending)}</strong></p>
        </Card>
        <Card>
          <SectionTitle label="Verification" />
          <div className="space-y-4 pt-1">
            <MetricBar label="Verified payments" display={String(verified.length)} value={verified.length} max={payMax} color="#15803d" />
            <MetricBar label="Pending payments" display={String(unverified.length)} value={unverified.length} max={payMax} color="#d4a017" />
            <MetricBar label="Rejected orders" display={String(rejected)} value={rejected} max={Math.max(scoped.length, 1)} color="#b91c1c" />
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle label="Bank statements" action={<Link href="/verification" className="text-sm font-semibold text-gold-dark">View all →</Link>} />
        <TableWrap>
          <thead><tr><Th>File</Th><Th>Uploaded by</Th><Th className="text-right">Rows</Th></tr></thead>
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
    </div>
  );
}

// Uniform select control used by the dashboard header's period picker.
const CTRL = "h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-gold";
