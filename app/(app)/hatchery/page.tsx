"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { GreetingHeader, StatTile, SectionTitle, SearchTimeBar } from "@/components/dashboard/DashKit";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { presetToRange, type PeriodPreset } from "@/lib/period";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { formatRWF } from "@/lib/config";
import { computeKpis, hatchabilityPct, stepLabel, isMachineOverTemp } from "@/lib/hatchery/lifecycle";
import { deliveryDateOf } from "@/lib/projection";
import { visibleOrders } from "@/lib/permissions";
import { PRODUCTS, isFullyPaid, type Order, type User } from "@/lib/types";
import type { Batch } from "@/lib/hatchery/types";

const HATCHERY_SUBTITLE: Partial<Record<string, string>> = {
  "Hatchery Veterinary": "here's health & vaccination today",
  "Maintenance Technician": "here's machines & maintenance today",
  "Hatchery Sales & Coordination Officer": "here's sales coordination today",
  "Production Technician": "here's the production floor today",
};

/** Shared search + period filter passed to every hatchery dashboard view. */
export interface DashFilter {
  q: string;
  range: DateRangeValue;
}

/** Text match against a set of fields (empty query = match all). */
function matches(q: string, ...fields: (string | undefined)[]): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(s));
}
/** Date-in-range test (no range set = match all). */
function inFilterRange(dateIso: string | undefined, range: DateRangeValue): boolean {
  if (!(range.from || range.to)) return true;
  return inRange((dateIso ?? "").slice(0, 10), range);
}

export default function HatcheryDashboard() {
  const { user } = useAuth();

  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const range = presetToRange(preset, custom, todayISO());

  if (!user) return null;

  const role = user.role;
  const filter: DashFilter = { q, range };
  // The manager/admin overview is self-contained — no greeting header there.
  const SPECIAL_VIEWS = ["Hatchery Veterinary", "Maintenance Technician", "Hatchery Sales & Coordination Officer", "Production Technician", "Hatchery Operations Manager"];
  const isManagerDash = !SPECIAL_VIEWS.includes(role);
  return (
    <div className="space-y-5">
      {!isManagerDash && (
        <GreetingHeader name={user.name} subtitle={HATCHERY_SUBTITLE[role] ?? "here's the hatchery today"} right={<Pill tone="gold">{role}</Pill>} />
      )}

      <div className="sticky top-16 z-20 -mx-4 md:-mx-8 border-b border-line bg-cream/95 px-4 md:px-8 py-2.5 backdrop-blur">
        <SearchTimeBar q={q} setQ={setQ} placeholder="Search this dashboard…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />
      </div>

      {role === "Hatchery Veterinary" ? (
        <VetView filter={filter} />
      ) : role === "Maintenance Technician" ? (
        <MaintenanceView filter={filter} />
      ) : role === "Hatchery Sales & Coordination Officer" ? (
        <CoordinationView user={user} filter={filter} />
      ) : role === "Production Technician" ? (
        <TechView filter={filter} />
      ) : role === "Hatchery Operations Manager" ? (
        <ProductionView filter={filter} />
      ) : (
        <ManagerView user={user} filter={filter} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function BatchesCard({ batches, filter, title = "Batches" }: { batches: Batch[]; filter?: DashFilter; title?: string }) {
  const rows = batches
    .filter((b) => !filter || (matches(filter.q, b.batchNo, b.productType, stepLabel(b.currentStep)) && inFilterRange(b.createdAt, filter.range)))
    .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 12);
  const tone = (s: Batch["status"]) =>
    s === "delivered" ? "fulfilled" : s === "dispatched" ? "gold" : s === "inactive" ? "neutral" : "info";
  return (
    <Card>
      <SectionTitle label={title} />
      <TableWrap>
        <thead>
          <tr>
            <Th>Batch</Th><Th>Product</Th><Th>Step</Th>
            <Th className="text-right">Eggs set</Th><Th className="text-right">Hatched</Th>
            <Th className="text-right">Saleable</Th><Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} text="No batches yet." />
          ) : rows.map((b) => (
            <tr key={b.id}>
              <Td><Link href={`/hatchery/batches/${b.id}`} className="text-gold-dark">{b.batchNo}</Link></Td>
              <Td>{b.productType}</Td>
              <Td>{stepLabel(b.currentStep)}</Td>
              <Td className="text-right">{b.eggsSet.toLocaleString()}</Td>
              <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
              <Td className="text-right">{b.saleableCount.toLocaleString()}</Td>
              <Td><Pill tone={tone(b.status)}>{b.status}</Pill></Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

function OverTempCard() {
  const { readings } = useHatchery();
  const alerts = useMemo(
    () => readings.filter((r) => isMachineOverTemp(r.dryF, r.wetF, r.digitalTempF)).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 6),
    [readings]
  );
  if (alerts.length === 0) return null;
  return (
    <Card>
      <SectionTitle label="Recent over-temperature readings" />
      <div className="space-y-1.5 text-sm">
        {alerts.map((r) => (
          <div key={r.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-red/30 bg-red-bg px-3 py-2">
            <span>{r.machineCode} · {r.operator}</span>
            <span className="text-red">dry {r.dryF}°F · wet {r.wetF}°F · digital {r.digitalTempF}°F · {formatDateTime(r.timestamp)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const awaitingVaccination = (b: Batch) => !!b.steps["counting"] && !b.vaccinated;
const inPipeline = (b: Batch) => !!b.steps["setting"] && !b.steps["hatching"] && b.status === "active";

function payState(o: Order): { label: string; tone: "green" | "gold" | "red" | "info" } {
  if (isFullyPaid(o)) return { label: "Paid", tone: "green" };
  if (o.debtOk) return { label: "On debt", tone: "info" };
  if (o.payments.some((p) => p.amt > 0)) return { label: "Partial", tone: "gold" };
  return { label: "Unpaid", tone: "red" };
}
const ordersToDeliver = (orders: Order[], user: User) =>
  visibleOrders(orders, user).filter((o) => o.confirmedOk && o.status !== "refunded" && o.status !== "rejected" && !o.deliverOk);

// ---------------------------------------------------------------------------
// Manager (Admin / Hatchery Manager / Operations Manager) — full overview
// ---------------------------------------------------------------------------

function ManagerView({ user, filter }: { user: User; filter: DashFilter }) {
  const { batches, inventory, maintenance, allocations, dispatches, supplies, spareParts, spareRequests, machines, receptions } = useHatchery();
  const { orders } = useData();
  const today = todayISO();

  const kpis = useMemo(() => computeKpis(batches, inventory), [batches, inventory]);

  // Rolling 7-day windows for week-over-week trends.
  const thisFrom = addDaysISO(today, -6);
  const prevFrom = addDaysISO(today, -13);
  const prevTo = addDaysISO(today, -7);
  const setDateOf = (b: Batch) => b.setDate ?? b.createdAt.slice(0, 10);
  const stepDay = (b: Batch, key: string) => b.steps[key]?.on?.slice(0, 10);
  const inWin = (d: string | undefined, from: string, to: string) => !!d && d >= from && d <= to;

  const eggsThis = sum(batches.filter((b) => inWin(setDateOf(b), thisFrom, today)).map((b) => b.eggsSet || 0));
  const eggsPrev = sum(batches.filter((b) => inWin(setDateOf(b), prevFrom, prevTo)).map((b) => b.eggsSet || 0));
  const hatchThis = sum(batches.filter((b) => inWin(stepDay(b, "hatching"), thisFrom, today)).map((b) => b.hatchedCount || 0));
  const hatchPrev = sum(batches.filter((b) => inWin(stepDay(b, "hatching"), prevFrom, prevTo)).map((b) => b.hatchedCount || 0));
  const hbThis = avg(batches.filter((b) => b.hatchedCount > 0 && inWin(stepDay(b, "hatching"), thisFrom, today)).map(hatchabilityPct));
  const hbPrev = avg(batches.filter((b) => b.hatchedCount > 0 && inWin(stepDay(b, "hatching"), prevFrom, prevTo)).map(hatchabilityPct));
  const trends = {
    setToday: batches.filter((b) => setDateOf(b) === today).length,
    eggs: pctTrend(eggsThis, eggsPrev),
    hatched: pctTrend(hatchThis, hatchPrev),
    hatchability: ppTrend(hbThis, hbPrev),
    producedWeek: sum(batches.filter((b) => inWin(stepDay(b, "counting"), thisFrom, today)).map((b) => b.saleableCount || 0)),
  };

  const activeMachines = machines.filter((m) => m.active).length;
  const downtime = maintenance.reduce((s, m) => s + (m.downtimeHours ?? 0), 0);
  const pendingAlloc = allocations.filter((a) => a.status === "proposed" || a.status === "finalized").length;
  const inTransit = dispatches.filter((d) => !d.deliveredAt).length;
  const toDeliver = ordersToDeliver(orders, user);
  const demand = toDeliver.reduce((s, o) => s + o.chicks, 0);
  const lowStock = supplies.filter((s) => s.quantity <= 0).length + spareParts.filter((p) => p.quantity <= 0).length;
  const pendingParts = spareRequests.filter((r) => r.status === "pending").length;

  const perf = useMemo(() => computePerformance(batches), [batches]);
  const series = useMemo(() => performanceSeries(batches), [batches]);

  const eggsToday = sum(receptions.filter((r) => r.date === today).map((r) => r.eggsReceived || 0));
  const hatchedToday = sum(batches.filter((b) => stepDay(b, "hatching") === today).map((b) => b.hatchedCount || 0));
  const saleableToday = sum(batches.filter((b) => stepDay(b, "vaccination") === today).map((b) => b.saleableCount || 0));
  const deliveredToday = sum(orders.filter((o) => o.deliverOk && o.date === today).map((o) => o.chicks || 0));

  return (
    <>
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <BigStat icon={<IcoTray />} tone="green" label="Active batches" value={kpis.activeBatches.toLocaleString()} trend={trends.setToday > 0 ? { dir: "up", text: `${trends.setToday} set today` } : undefined} />
        <BigStat icon={<IcoEgg />} tone="gold" label="Eggs set" value={kpis.eggsSet.toLocaleString()} trend={trends.eggs} />
        <BigStat icon={<IcoChick />} tone="green" label="Chicks hatched" value={kpis.chicksHatched.toLocaleString()} trend={trends.hatched} />
        <BigStat icon={<IcoPercent />} tone="gold" label="Hatchability" value={`${kpis.hatchability.toFixed(0)}%`} trend={trends.hatchability} />
        <BigStat icon={<IcoChick />} tone="green" label="Available chicks" value={kpis.saleableAvailable.toLocaleString()} trend={trends.producedWeek > 0 ? { dir: "up", text: `${trends.producedWeek.toLocaleString()} this week` } : undefined} />
      </div>

      {/* Operational tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MiniStat icon={<IcoTruck />} tone={demand ? "gold" : "default"} label="Chicks to deliver" value={demand.toLocaleString()} sub="Scheduled" />
        <MiniStat icon={<IcoClipboard />} label="Orders awaiting" value={String(toDeliver.length)} sub="To be confirmed" />
        <MiniStat icon={<IcoUsers />} tone={pendingAlloc ? "gold" : "default"} label="Pending allocations" value={String(pendingAlloc)} sub="Needs attention" />
        <MiniStat icon={<IcoTruck />} label="In transit" value={String(inTransit)} sub="On the way" />
        <MiniStat icon={<IcoClock />} tone={downtime > 0 ? "red" : "default"} label="Downtime (h)" value={downtime.toFixed(1)} sub="Today" />
        <MiniStat icon={<IcoWrench />} tone={lowStock || pendingParts ? "gold" : "default"} label="Low / pending parts" value={`${lowStock} / ${pendingParts}`} sub="Low / Pending" />
        <MiniStat icon={<IcoGear />} label="Active machines" value={String(activeMachines)} sub="Online" />
      </div>

      {/* Batch overview + performance */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BatchOverviewCard batches={batches} filter={filter} />
        <PerformanceCard perf={perf} series={series} />
      </div>

      {/* Today */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MiniStat icon={<IcoEgg />} label="Eggs today" value={eggsToday.toLocaleString()} sub="Total received" />
        <MiniStat icon={<IcoChick />} tone="green" label="Chicks hatched today" value={hatchedToday.toLocaleString()} sub="Including culls" />
        <MiniStat icon={<IcoShield />} tone="green" label="Saleable chicks today" value={saleableToday.toLocaleString()} sub="Vaccinated" />
        <MiniStat icon={<IcoTruck />} label="Orders delivered today" value={deliveredToday.toLocaleString()} sub="Chicks" />
        <MiniStat icon={<IcoShield />} tone="green" label="Vaccination rate" value={`${perf.vaccinationRate.toFixed(1)}%`} sub="Overall" />
      </div>

      <OverTempCard />
    </>
  );
}

// ---- Manager dashboard building blocks ------------------------------------

const num = (n: number) => (Number.isFinite(n) ? n : 0);
function sum(nums: number[]): number { return nums.reduce((s, n) => s + num(n), 0); }
function avg(nums: number[]): number { return nums.length ? sum(nums) / nums.length : 0; }
function stageRemoved(b: Batch, stage: 1 | 2): number {
  return (b.candlings ?? []).filter((c) => c.stage === stage).reduce((s, c) => s + (c.totalRemoved || 0), 0);
}

interface Trend { dir: "up" | "down"; text: string }
function pctTrend(cur: number, prev: number): Trend | undefined {
  if (prev <= 0) return undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return undefined;
  return { dir: pct > 0 ? "up" : "down", text: `${Math.abs(pct)}% this week` };
}
function ppTrend(cur: number, prev: number): Trend | undefined {
  const d = Math.round(cur - prev);
  if (!d) return undefined;
  return { dir: d > 0 ? "up" : "down", text: `${Math.abs(d)} pts vs last week` };
}

interface Performance { fertility: number; hatchability: number; quality: number; mortality: number; vaccinationRate: number }
function computePerformance(batches: Batch[]): Performance {
  const candled = batches.filter((b) => (b.eggsSet || 0) > 0 && (b.candlings?.length || b.hatchedCount > 0));
  const setEggs = sum(candled.map((b) => b.eggsSet || 0));
  const infertile = sum(candled.map((b) => stageRemoved(b, 1)));
  const hatchedB = batches.filter((b) => b.hatchedCount > 0);
  const fertileHatched = sum(hatchedB.map((b) => Math.max(1, (b.eggsSet || 0) - stageRemoved(b, 1))));
  const hatched = sum(hatchedB.map((b) => b.hatchedCount || 0));
  const saleable = sum(hatchedB.map((b) => b.saleableCount || 0));
  const deadInShell = sum(hatchedB.map((b) => stageRemoved(b, 2)));
  const counted = batches.filter((b) => b.steps["counting"]);
  const countedSale = sum(counted.map((b) => b.saleableCount || 0));
  const vaxSale = sum(counted.filter((b) => b.vaccinated).map((b) => b.saleableCount || 0));
  return {
    fertility: setEggs > 0 ? ((setEggs - infertile) / setEggs) * 100 : 0,
    hatchability: fertileHatched > 0 ? (hatched / fertileHatched) * 100 : 0,
    quality: hatched > 0 ? (saleable / hatched) * 100 : 0,
    mortality: fertileHatched > 0 ? (deadInShell / fertileHatched) * 100 : 0,
    vaccinationRate: countedSale > 0 ? (vaxSale / countedSale) * 100 : 0,
  };
}

interface SeriesPoint { label: string; fertility: number; hatchability: number; quality: number; mortality: number }
function performanceSeries(batches: Batch[]): SeriesPoint[] {
  return batches
    .filter((b) => b.hatchedCount > 0 && b.steps["hatching"])
    .sort((a, b) => (a.steps["hatching"]!.on < b.steps["hatching"]!.on ? -1 : 1))
    .slice(-8)
    .map((b) => {
      const set = b.eggsSet || 0;
      const fertile = Math.max(1, set - stageRemoved(b, 1));
      return {
        label: formatDate(b.steps["hatching"]!.on.slice(0, 10)),
        fertility: set > 0 ? ((set - stageRemoved(b, 1)) / set) * 100 : 0,
        hatchability: (b.hatchedCount / fertile) * 100,
        quality: b.hatchedCount > 0 ? ((b.saleableCount || 0) / b.hatchedCount) * 100 : 0,
        mortality: (stageRemoved(b, 2) / fertile) * 100,
      };
    });
}

type StatTone = "green" | "gold" | "red" | "blue" | "default";
const CHIP: Record<StatTone, string> = {
  green: "bg-green-bg text-green",
  gold: "bg-gold-bg text-gold-dark",
  red: "bg-red-bg text-red",
  blue: "bg-blue-bg text-blue",
  default: "bg-grey-bg text-ink",
};

function BigStat({ icon, tone = "default", label, value, trend }: { icon: ReactNode; tone?: StatTone; label: string; value: string; trend?: Trend }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${CHIP[tone]}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.09em] text-muted">{label}</p>
          <p className="mt-0.5 truncate text-[1.55rem] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</p>
          {trend && (
            <p className={`mt-1 flex items-center gap-1 text-[0.7rem] font-semibold ${trend.dir === "up" ? "text-green" : "text-red"}`}>
              <span aria-hidden>{trend.dir === "up" ? "↗" : "↘"}</span>{trend.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon, tone = "default", label, value, sub }: { icon: ReactNode; tone?: StatTone; label: string; value: string; sub?: string }) {
  const valueColor = tone === "green" ? "text-green" : tone === "gold" ? "text-gold-dark" : tone === "red" ? "text-red" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paper p-3 shadow-card">
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${CHIP[tone]}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[0.56rem] font-bold uppercase tracking-[0.08em] text-muted">{label}</p>
          <p className={`truncate text-[1.15rem] font-bold leading-tight tabular-nums ${valueColor}`}>{value}</p>
          {sub && <p className="truncate text-[0.62rem] text-muted">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// Step colours for the batch overview (matches the pipeline legend).
const STEP_COLOR: Record<string, string> = {
  setting: "#3b82f6", "candling-1": "#e0a92e", "candling-2": "#7c3aed", hatching: "#e8843a", counting: "#3f9142",
};
const STEP_LEGEND = [
  { key: "setting", label: "Setting" },
  { key: "candling-1", label: "Candling I" },
  { key: "candling-2", label: "Candling II" },
  { key: "hatching", label: "Hatching" },
  { key: "counting", label: "Counting & boxing" },
];

function BatchOverviewCard({ batches, filter }: { batches: Batch[]; filter: DashFilter }) {
  const rows = batches
    .filter((b) => matches(filter.q, b.batchNo, b.productType, stepLabel(b.currentStep)) && inFilterRange(b.createdAt, filter.range))
    .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 7);
  const dot = (step: string) => STEP_COLOR[step] ?? "#9aa0a6";
  return (
    <Card>
      <SectionTitle label="Batch overview" action={<Link href="/hatchery/batches" className="text-xs font-semibold text-gold-dark">View all batches →</Link>} />
      <TableWrap>
        <thead>
          <tr>
            <Th>Batch</Th><Th>Product</Th><Th>Step</Th>
            <Th className="text-right">Eggs set</Th><Th className="text-right">Hatched</Th>
            <Th className="text-right">Saleable</Th><Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} text="No batches yet." />
          ) : rows.map((b) => (
            <tr key={b.id}>
              <Td className="whitespace-nowrap"><Link href={`/hatchery/batches/${b.id}`} className="font-medium text-gold-dark">{b.batchNo}</Link></Td>
              <Td>{b.productType}</Td>
              <Td><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: dot(b.currentStep) }} />{stepLabel(b.currentStep)}</span></Td>
              <Td className="text-right">{b.eggsSet.toLocaleString()}</Td>
              <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
              <Td className="text-right">{b.saleableCount.toLocaleString()}</Td>
              <Td><Pill tone={b.status === "delivered" ? "fulfilled" : b.status === "dispatched" ? "gold" : b.status === "inactive" ? "neutral" : "green"}>{b.status}</Pill></Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {STEP_LEGEND.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[0.68rem] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: STEP_COLOR[s.key] }} />{s.label}
          </span>
        ))}
      </div>
    </Card>
  );
}

const PERF_SERIES = [
  { key: "fertility" as const, label: "Fertility", color: "#3f9142" },
  { key: "hatchability" as const, label: "Hatchability", color: "#e0a92e" },
  { key: "quality" as const, label: "Chick Quality", color: "#3b82f6" },
  { key: "mortality" as const, label: "Mortality (In-shell)", color: "#d9534f" },
];

function PerformanceCard({ perf, series }: { perf: Performance; series: SeriesPoint[] }) {
  return (
    <Card>
      <SectionTitle label="Hatchery performance" action={<span className="text-xs font-semibold text-muted">Recent batches</span>} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <PerfTile label="Fertility" value={perf.fertility} tone="green" />
        <PerfTile label="Hatchability" value={perf.hatchability} tone="green" />
        <PerfTile label="Chick Quality" value={perf.quality} tone="green" />
        <PerfTile label="Mortality (In-shell)" value={perf.mortality} tone="red" />
      </div>
      <div className="mt-4">
        <PerfChart series={series} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {PERF_SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[0.68rem] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
    </Card>
  );
}

function PerfTile({ label, value, tone }: { label: string; value: number; tone: "green" | "red" }) {
  return (
    <div className="rounded-xl border border-line bg-cream/40 px-3 py-2.5 text-center">
      <p className={`text-[1.3rem] font-extrabold leading-none tabular-nums ${tone === "red" ? "text-red" : "text-green"}`}>{value.toFixed(1)}%</p>
      <p className="mt-1 text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function PerfChart({ series }: { series: SeriesPoint[] }) {
  const W = 460, H = 180, padL = 28, padB = 24, padT = 8, padR = 8;
  if (series.length < 2) {
    return <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">Not enough hatched batches yet for a trend.</div>;
  }
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (i: number) => padL + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const y = (v: number) => padT + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
  const path = (key: keyof SeriesPoint) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key] as number).toFixed(1)}`).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Hatchery performance trend">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="#ece7db" strokeWidth={1} />
            <text x={padL - 5} y={y(g) + 3} textAnchor="end" fontSize="8" className="fill-muted">{g}</text>
          </g>
        ))}
        {series.map((p, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="8" className="fill-muted">{p.label}</text>
        ))}
        {PERF_SERIES.map((s) => (
          <g key={s.key}>
            <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
            {series.map((p, i) => <circle key={i} cx={x(i)} cy={y(p[s.key] as number)} r={2.2} fill={s.color} />)}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---- inline icons (manager dashboard) -------------------------------------
const dsvg = (children: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoTray = () => dsvg(<><path d="M3 8l9-4 9 4-9 4-9-4Z" /><path d="M3 8v5l9 4 9-4V8M3 13l9 4 9-4" /></>);
const IcoEgg = () => dsvg(<ellipse cx="12" cy="13" rx="6" ry="8" />);
const IcoChick = () => dsvg(<><ellipse cx="12" cy="13.5" rx="6" ry="7" /><path d="M12 6.5V4" /><circle cx="10" cy="12" r=".6" fill="currentColor" /></>);
const IcoPercent = () => dsvg(<><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2" /><circle cx="16.5" cy="16.5" r="2" /></>);
const IcoTruck = () => dsvg(<><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>);
const IcoClipboard = () => dsvg(<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9zM9 11h6M9 15h4" /></>);
const IcoUsers = () => dsvg(<><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 7a3 3 0 0 1 0 6M20.5 19a5.5 5.5 0 0 0-3-4.9" /></>);
const IcoClock = () => dsvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoWrench = () => dsvg(<path d="M15 5a4 4 0 0 0-5 5L4 16l4 4 6-6a4 4 0 0 0 5-5l-3 3-2-2 3-3a4 4 0 0 0-2-2Z" />);
const IcoGear = () => dsvg(<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>);
const IcoShield = () => dsvg(<><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3Z" /><path d="M9 12l2 2 4-4" /></>);

// ---------------------------------------------------------------------------
// Hatchery Operations Manager — production overview
// ---------------------------------------------------------------------------

function ProductionView({ filter }: { filter: DashFilter }) {
  const { batches, inventory, machines, machineIssues, maintenance, spareParts, spareRequests } = useHatchery();
  const kpis = useMemo(() => computeKpis(batches, inventory), [batches, inventory]);
  const activeMachines = machines.filter((m) => m.active).length;

  // Where every active batch sits in the reception → set → candle → hatch →
  // count/box → vaccinate flow, so the ops manager sees what the floor owes today.
  const stages = useMemo(() => {
    const active = batches.filter((b) => b.status === "active");
    return {
      toSet: active.filter((b) => !b.steps["setting"]).length,
      toCandle: batches.filter(inPipeline).length,
      inHatchers: batches.filter((b) => b.steps["transfer"] && !b.steps["hatching"]).length,
      toCount: batches.filter((b) => b.steps["hatching"] && !b.steps["counting"]).length,
      toVaccinate: batches.filter(awaitingVaccination).length,
    };
  }, [batches]);

  const openIssues = machineIssues.filter((i) => i.status === "open").length;
  const downtime = maintenance.reduce((s, m) => s + (m.downtimeHours ?? 0), 0);
  const outParts = spareParts.filter((p) => p.quantity <= 0).length;
  const pendingSpares = spareRequests.filter((r) => r.status === "pending").length;

  const openIssueRows = useMemo(
    () => machineIssues
      .filter((i) => i.status === "open" && matches(filter.q, i.machineCode, i.description))
      .sort((a, b) => (a.on < b.on ? 1 : -1)),
    [machineIssues, filter]
  );
  const recentMaint = useMemo(
    () => maintenance
      .filter((m) => matches(filter.q, m.area, m.kind, m.notes) && inFilterRange(m.on, filter.range))
      .slice().sort((a, b) => (a.on < b.on ? 1 : -1)).slice(0, 8),
    [maintenance, filter]
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Active batches" value={String(kpis.activeBatches)} />
        <StatTile label="Eggs set" value={kpis.eggsSet.toLocaleString()} />
        <StatTile label="Chicks hatched" value={kpis.chicksHatched.toLocaleString()} tone="green" />
        <StatTile label="Hatchability" value={`${kpis.hatchability.toFixed(0)}%`} tone="gold" />
        <StatTile label="Available chicks" value={kpis.saleableAvailable.toLocaleString()} tone="green" />
        <StatTile label="Active machines" value={String(activeMachines)} />
      </div>

      <Card>
        <SectionTitle label="Today's production pipeline" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="To set" value={String(stages.toSet)} tone={stages.toSet ? "gold" : "default"} />
          <StatTile label="Incubating / to candle" value={String(stages.toCandle)} />
          <StatTile label="In hatchers" value={String(stages.inHatchers)} />
          <StatTile label="To count & box" value={String(stages.toCount)} tone={stages.toCount ? "gold" : "default"} />
          <StatTile label="Awaiting vaccination" value={String(stages.toVaccinate)} tone={stages.toVaccinate ? "gold" : "default"} />
        </div>
      </Card>

      <Card>
        <SectionTitle label="Needs attention" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Open machine issues" value={String(openIssues)} tone={openIssues ? "red" : "green"} />
          <StatTile label="Maintenance downtime (h)" value={downtime.toLocaleString()} tone={downtime ? "gold" : "default"} />
          <StatTile label="Spare parts out of stock" value={String(outParts)} tone={outParts ? "red" : "green"} />
          <StatTile label="Spare requests pending" value={String(pendingSpares)} tone={pendingSpares ? "gold" : "default"} />
        </div>
      </Card>

      {openIssueRows.length > 0 && (
        <Card>
          <SectionTitle label={`Open machine issues (${openIssueRows.length})`} />
          <TableWrap>
            <thead><tr><Th>Machine</Th><Th>Severity</Th><Th>Issue</Th><Th>Reported</Th></tr></thead>
            <tbody>
              {openIssueRows.map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.machineCode}</Td>
                  <Td><Pill tone={i.severity === "high" ? "red" : i.severity === "medium" ? "gold" : "neutral"}>{i.severity}</Pill></Td>
                  <Td className="text-sm">{i.description}</Td>
                  <Td className="text-xs text-muted">{i.reporterName ?? i.reportedBy} · {formatDateTime(i.on)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      <Card>
        <SectionTitle label="Recent maintenance" />
        <TableWrap>
          <thead><tr><Th>When</Th><Th>Area</Th><Th>Note</Th><Th className="text-right">Downtime (h)</Th></tr></thead>
          <tbody>
            {recentMaint.length === 0 ? <EmptyRow colSpan={4} text="No maintenance logged." /> : recentMaint.map((m) => (
              <tr key={m.id}>
                <Td className="text-xs text-muted">{formatDate(m.on.slice(0, 10))}</Td>
                <Td>{m.area ?? m.kind}</Td>
                <Td className="text-sm">{m.notes}</Td>
                <Td className="text-right">{(m.downtimeHours ?? 0).toFixed(1)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <OverTempCard />
      <BatchesCard batches={batches} filter={filter} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Production Technician — production tasks
// ---------------------------------------------------------------------------

function TechView({ filter }: { filter: DashFilter }) {
  const { batches, machines } = useHatchery();
  const toCandle = batches.filter(inPipeline);
  const inHatchers = batches.filter((b) => b.steps["transfer"] && !b.steps["hatching"]);
  const activeMachines = machines.filter((m) => m.active).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Batches to candle" value={String(toCandle.length)} tone={toCandle.length ? "gold" : "default"} />
        <StatTile label="In hatchers" value={String(inHatchers.length)} />
        <StatTile label="Active batches" value={String(batches.filter((b) => b.status === "active").length)} />
        <StatTile label="Active machines" value={String(activeMachines)} />
      </div>
      <OverTempCard />
      <BatchesCard batches={batches.filter((b) => b.status === "active")} filter={filter} title="Active pipeline" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Hatchery Veterinary — health / vaccination
// ---------------------------------------------------------------------------

function VetView({ filter }: { filter: DashFilter }) {
  const { batches, vaccineRequests, farmVisits, biosecurity } = useHatchery();
  const today = todayISO();

  const dueDate = (b: Batch) => (b.setDate ? deliveryDateOf(b.setDate) : "");
  const daysLeft = (iso: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);

  const toVax = batches
    .filter(awaitingVaccination)
    .filter((b) => matches(filter.q, b.batchNo, b.productType) && inFilterRange(b.createdAt, filter.range))
    .slice()
    .sort((a, b) => ((dueDate(a) || "9999") < (dueDate(b) || "9999") ? -1 : 1));
  const pendingReq = vaccineRequests
    .filter((r) => r.status === "requested" || r.status === "confirmed")
    .filter((r) => matches(filter.q, r.vaccine, r.status));

  const counted = (b: Batch) => b.countedTotal || b.saleableCount || 0;
  const totalCounted = toVax.reduce((s, b) => s + counted(b), 0);
  const totalCulls = toVax.reduce((s, b) => s + (b.culls || 0), 0);
  const avgCullPct = totalCounted + totalCulls > 0 ? (totalCulls / (totalCounted + totalCulls)) * 100 : 0;

  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <VetStat icon={<IcoSyringe />} tone="gold" value={String(toVax.length)} label="Batches to vaccinate" sub="Due for vaccination" />
        <VetStat icon={<IcoClipboard />} tone="purple" value={String(pendingReq.length)} label="Pending vaccine requests" sub="Requests to act on" />
        <VetStat icon={<IcoTruck />} tone="green" value={String(farmVisits.length)} label="Farm visits logged" sub="Logged" />
        <VetStat icon={<IcoShield />} tone="blue" value={String(biosecurity.length)} label="Biosecurity logs" sub="Logged" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Batches awaiting vaccination */}
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <SectionTitle label={`Batches awaiting vaccination (${toVax.length})`} />
            <Link href="/hatchery/vaccination" className="shrink-0 text-xs font-semibold text-gold-dark hover:underline">View all</Link>
          </div>
          <TableWrap>
            <thead><tr><Th>Batch</Th><Th>Product</Th><Th className="text-right">Counted</Th><Th className="text-right">Culls</Th><Th>Due date</Th></tr></thead>
            <tbody>
              {toVax.length === 0 ? <EmptyRow colSpan={5} text="Nothing awaiting vaccination." /> : toVax.map((b) => {
                const dd = dueDate(b);
                const dl = dd ? daysLeft(dd) : null;
                return (
                  <tr key={b.id}>
                    <Td><Link href={`/hatchery/batches/${b.id}`} className="whitespace-nowrap font-medium text-gold-dark">{b.batchNo}</Link></Td>
                    <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: b.productType === "Ross 308" ? "#1565c0" : "#b8860b" }} />{b.productType}</span></Td>
                    <Td className="text-right tabular-nums">{counted(b).toLocaleString()}</Td>
                    <Td className="text-right tabular-nums">{b.culls.toLocaleString()}</Td>
                    <Td>{dd ? (
                      <div>
                        <p className="whitespace-nowrap text-xs">{formatDate(dd)}</p>
                        {dl !== null && <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[0.6rem] font-semibold ${dl < 0 ? "bg-red-bg text-red" : dl <= 2 ? "bg-gold-bg text-gold-dark" : "bg-green-bg text-green"}`}>{dl < 0 ? `${-dl}d overdue` : dl === 0 ? "today" : `${dl} days left`}</span>}
                      </div>
                    ) : <span className="text-muted">—</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          {toVax.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3">
              <FooterStat label="Total counted" value={totalCounted.toLocaleString()} />
              <FooterStat label="Total culls" value={totalCulls.toLocaleString()} />
              <FooterStat label="Avg cull %" value={`${avgCullPct.toFixed(2)}%`} />
            </div>
          )}
        </Card>

        {/* Vaccine requests to act on */}
        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <SectionTitle label={`Vaccine requests (${pendingReq.length})`} />
            <Link href="/hatchery/vaccine-requests" className="shrink-0 text-xs font-semibold text-gold-dark hover:underline">View all</Link>
          </div>
          {pendingReq.length === 0 ? (
            <div className="grid place-items-center py-8 text-center">
              <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-purple-bg text-purple"><IcoClipboardCheck /></span>
              <p className="font-semibold text-ink">No pending requests</p>
              <p className="mt-1 max-w-[16rem] text-xs text-muted">All caught up — there are no vaccine requests waiting for your action.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingReq.slice(0, 6).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium text-ink">{r.vaccine}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">{r.quantity.toLocaleString()} {r.unit}<Pill tone={r.status === "confirmed" ? "gold" : "info"}>{r.status}</Pill></span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Quick actions */}
        <Card>
          <SectionTitle label="Quick actions" />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <QuickAction href="/hatchery/farm-visits" icon={<IcoPin />} label="Log farm visit" />
            <QuickAction href="/hatchery/vaccine-requests" icon={<IcoClipboard />} label="New vaccine request" />
            <QuickAction href="/hatchery/biosecurity" icon={<IcoShield />} label="Biosecurity log" />
            <QuickAction href="/hatchery/vaccination" icon={<IcoSyringe />} label="Vaccinate a batch" />
          </div>
        </Card>

        {/* Today's schedule */}
        <Card>
          <SectionTitle label="What needs vaccinating" />
          <div className="mt-3 space-y-2">
            {toVax.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">Nothing scheduled — all batches are vaccinated.</p>
            ) : toVax.slice(0, 5).map((b) => {
              const dd = dueDate(b);
              return (
                <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border-l-4 border-gold bg-gold-bg/40 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{b.batchNo} <span className="font-normal text-muted">({b.productType})</span></p>
                    <p className="text-xs text-muted">Vaccination due</p>
                  </div>
                  {dd && <span className="shrink-0 rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-ink">{formatDate(dd)}</span>}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-center"><Link href="/hatchery/vaccination" className="text-xs font-semibold text-gold-dark hover:underline">Go to vaccination →</Link></div>
        </Card>
      </div>
    </>
  );
}

// ---- Vet dashboard pieces --------------------------------------------------

type VetTone = "gold" | "purple" | "green" | "blue";
const VET_CHIP: Record<VetTone, string> = { gold: "bg-gold-bg text-gold-dark", purple: "bg-purple-bg text-purple", green: "bg-green-bg text-green", blue: "bg-blue-bg text-blue" };
const VET_ACCENT: Record<VetTone, string> = { gold: "bg-gold", purple: "bg-purple", green: "bg-green", blue: "bg-blue" };

function VetStat({ icon, value, label, sub, tone }: { icon: ReactNode; value: string; label: string; sub: string; tone: VetTone }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-paper p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${VET_CHIP[tone]}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[0.56rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-0.5 text-2xl font-extrabold leading-none tabular-nums text-ink">{value}</p>
          <p className="mt-1 truncate text-[0.62rem] text-muted">{sub}</p>
        </div>
      </div>
      <span className={`absolute inset-x-0 bottom-0 h-1 ${VET_ACCENT[tone]}`} aria-hidden />
    </div>
  );
}

function FooterStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function QuickAction({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-2 rounded-xl border border-line bg-paper p-3 text-center shadow-card transition hover:border-gold">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold-bg text-gold-dark">{icon}</span>
      <span className="text-xs font-semibold text-ink">{label}</span>
    </Link>
  );
}

const vsvg = (children: ReactNode) => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>);
const IcoSyringe = () => vsvg(<><path d="M4 20l2-2M17 3l4 4M14 6l4 4M15 5l-9 9v4h4l9-9M10 10l2 2" /></>);
const IcoClipboardCheck = () => vsvg(<><rect x="7" y="4" width="10" height="16" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 13l2 2 4-4" /></>);
const IcoPin = () => vsvg(<><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>);

// ---------------------------------------------------------------------------
// Maintenance Technician — machines & spare parts
// ---------------------------------------------------------------------------

function MaintenanceView({ filter }: { filter: DashFilter }) {
  const { readings, maintenance, machines, spareParts, spareRequests } = useHatchery();
  const alerts = readings.filter((r) => isMachineOverTemp(r.dryF, r.wetF, r.digitalTempF)).length;
  const downtime = maintenance.reduce((s, m) => s + (m.downtimeHours ?? 0), 0);
  const lowParts = spareParts.filter((p) => p.quantity <= 0).filter((p) => matches(filter.q, p.name, p.location));
  const pendingReq = spareRequests.filter((r) => r.status === "pending");
  const recentMaint = maintenance
    .filter((m) => matches(filter.q, m.area, m.kind, m.notes) && inFilterRange(m.on, filter.range))
    .slice().sort((a, b) => (a.on < b.on ? 1 : -1)).slice(0, 8);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Over-temp readings" value={String(alerts)} tone={alerts ? "red" : "default"} />
        <StatTile label="Downtime (h)" value={downtime.toFixed(1)} tone={downtime > 0 ? "red" : "default"} />
        <StatTile label="Machines" value={String(machines.length)} />
        <StatTile label="Parts out of stock" value={String(lowParts.length)} tone={lowParts.length ? "gold" : "default"} />
        <StatTile label="Part requests" value={String(pendingReq.length)} tone={pendingReq.length ? "gold" : "default"} />
      </div>
      <OverTempCard />

      <Card>
        <SectionTitle label="Spare parts needing attention" />
        <TableWrap>
          <thead><tr><Th>Part</Th><Th>Location</Th><Th className="text-right">In stock</Th></tr></thead>
          <tbody>
            {lowParts.length === 0 ? <EmptyRow colSpan={3} text="All spare parts in stock." /> : lowParts.map((p) => (
              <tr key={p.id}><Td className="font-medium">{p.name}</Td><Td className="text-muted">{p.location ?? "—"}</Td><Td className="text-right"><Pill tone="gold">out</Pill></Td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <SectionTitle label="Recent maintenance" />
        <TableWrap>
          <thead><tr><Th>When</Th><Th>Area</Th><Th>Note</Th><Th className="text-right">Downtime (h)</Th></tr></thead>
          <tbody>
            {recentMaint.length === 0 ? <EmptyRow colSpan={4} text="No maintenance logged." /> : recentMaint.map((m) => (
              <tr key={m.id}>
                <Td className="text-xs text-muted">{formatDate(m.on.slice(0, 10))}</Td>
                <Td>{m.area ?? m.kind}</Td>
                <Td className="text-sm">{m.notes}</Td>
                <Td className="text-right">{(m.downtimeHours ?? 0).toFixed(1)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hatchery Sales & Coordination Officer — sales coordination
// ---------------------------------------------------------------------------

const COORD_COLORS = { delivered: "#3f9142", ready: "#3b82f6", allocate: "#e0a92e", waiting: "#d9534f" };

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function sameMonth(iso: string | undefined, ref: string): boolean {
  return !!iso && iso.slice(0, 7) === ref.slice(0, 7);
}
function weekDays(today: string): { date: string; label: string; sub: string }[] {
  const d = new Date(today + "T00:00:00");
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return { date: day.toISOString().slice(0, 10), label: names[i], sub: `${day.getDate()} ${day.toLocaleString("en", { month: "short" })}` };
  });
}
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function Donut({ segments, total }: { segments: { value: number; color: string }[]; total: number }) {
  const size = 150, stroke = 20, r = (size - stroke) / 2, C = 2 * Math.PI * r;
  const arcs = segments.reduce<{ list: { len: number; start: number; color: string }[]; acc: number }>(
    (state, s) => {
      const len = total > 0 ? (s.value / total) * C : 0;
      return { list: [...state.list, { len, start: state.acc, color: s.color }], acc: state.acc + len };
    },
    { list: [], acc: 0 }
  ).list;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ece7db" strokeWidth={stroke} />
        {arcs.map((a, i) => (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.color} strokeWidth={stroke} strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.start} />
        ))}
      </g>
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="fill-ink" fontSize="22" fontWeight="700">{total}</text>
      <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" className="fill-muted" fontSize="10">Orders</text>
    </svg>
  );
}

function AttnRow({ tone, title, detail, count }: { tone: "red" | "gold" | "info"; title: string; detail: string; count: number }) {
  return (
    <Link href="/hatchery/coordination" className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:border-gold">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${tone === "red" ? "bg-red-bg text-red" : tone === "info" ? "bg-blue-bg text-blue" : "bg-gold-bg text-gold-dark"}`}>!</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      <span className="text-xs font-semibold text-muted">{count} orders ›</span>
    </Link>
  );
}

function ProdAllocBar({ product, reserved, remaining }: { product: string; reserved: number; remaining: number }) {
  const total = reserved + remaining;
  const pct = total > 0 ? Math.round((reserved / total) * 100) : 0;
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-ink">{product}</p>
      <div className="grid grid-cols-3 gap-1 text-xs text-muted">
        <span>Available <strong className="text-ink">{total.toLocaleString()}</strong></span>
        <span>Reserved <strong className="text-ink">{reserved.toLocaleString()}</strong></span>
        <span>Remaining <strong className="text-ink">{remaining.toLocaleString()}</strong></span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-right text-[11px] text-muted">{pct}% reserved</p>
    </div>
  );
}

function CoordinationView({ user, filter }: { user: User; filter: DashFilter }) {
  const { inventory, allocations, farmVisits } = useHatchery();
  const { orders, notifications } = useData();
  const today = todayISO();

  const active = useMemo(
    () => visibleOrders(orders, user).filter((o) => o.status !== "refunded" && o.status !== "rejected"),
    [orders, user]
  );
  const awaiting = useMemo(() => active.filter((o) => o.confirmedOk && !o.deliverOk), [active]);

  const chicksBy = (p: string) => awaiting.filter((o) => o.product === p).reduce((s, o) => s + o.chicks, 0);
  const reservedBy = (p: string) => allocations.filter((a) => a.status !== "cancelled" && a.productType === p).reduce((s, a) => s + a.quantity, 0);
  const invBy = (p: string) => inventory.filter((i) => i.productType === p).reduce((s, i) => s + i.availableCount, 0);
  const chicksInInv = inventory.reduce((s, i) => s + i.availableCount, 0);
  const revenueMonth = active.flatMap((o) => o.payments).filter((p) => p.verified && !p.voided && sameMonth(p.verifiedOn ?? p.on, today)).reduce((s, p) => s + p.amt, 0);

  const noAlloc = active.filter((o) => o.confirmedOk && !o.allocatedOk && !o.deliverOk);
  const awaitPay = active.filter((o) => !o.confirmedOk && !o.deliverOk);
  const dueToday = awaiting.filter((o) => o.date === today);

  const week = weekDays(today);
  const weekData = week.map((d) => ({ ...d, chicks: awaiting.filter((o) => o.date === d.date).reduce((s, o) => s + o.chicks, 0) }));
  const weekTotal = weekData.reduce((s, d) => s + d.chicks, 0);
  const weekMax = Math.max(1, ...weekData.map((d) => d.chicks));

  const status = {
    delivered: active.filter((o) => o.deliverOk).length,
    ready: active.filter((o) => o.allocatedOk && !o.deliverOk).length,
    allocate: active.filter((o) => o.confirmedOk && !o.allocatedOk && !o.deliverOk).length,
    waiting: active.filter((o) => !o.confirmedOk).length,
  };
  const totalOrders = active.length;
  const pctOf = (n: number) => (totalOrders ? Math.round((n / totalOrders) * 100) : 0);

  const recent = useMemo(
    () => active.filter((o) => matches(filter.q, o.name, o.product)).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5),
    [active, filter.q]
  );
  const visits = farmVisits.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4);
  const notifs = notifications.slice(0, 4);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Today's deliveries" value={String(dueToday.length)} />
        <StatTile label="Tomorrow's deliveries" value={String(awaiting.filter((o) => o.date === addDaysISO(today, 1)).length)} />
        <StatTile label="Awaiting payment" value={String(awaitPay.length)} tone={awaitPay.length ? "gold" : "default"} />
        <StatTile label="Ready for allocation" value={String(noAlloc.length)} tone={noAlloc.length ? "gold" : "default"} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Ross 308 to deliver" value={chicksBy("Ross 308").toLocaleString()} tone="gold" />
        <StatTile label="Tetra Super Harco to deliver" value={chicksBy("Tetra Super Harco").toLocaleString()} tone="gold" />
        <StatTile label="Chicks in inventory" value={chicksInInv.toLocaleString()} tone={chicksInInv ? "green" : "default"} />
        <StatTile label="Revenue (this month)" value={formatRWF(revenueMonth)} tone="green" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle label={`Delivery calendar — this week (${weekTotal.toLocaleString()} chicks)`} />
          <div className="flex h-44 items-end gap-2 pt-2">
            {weekData.map((d) => (
              <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] text-muted">{d.chicks ? d.chicks.toLocaleString() : ""}</span>
                <div className="w-full rounded-t bg-gold" style={{ height: `${(d.chicks / weekMax) * 100}%`, minHeight: d.chicks ? 3 : 0 }} title={`${d.chicks} chicks`} />
                <span className="text-[10px] font-medium text-ink">{d.label}</span>
                <span className="text-[9px] text-muted">{d.sub}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle label="Orders requiring attention" action={<Link href="/hatchery/coordination" className="text-xs font-semibold text-gold-dark">View all →</Link>} />
          <div className="space-y-2">
            {awaitPay.length === 0 && noAlloc.length === 0 && dueToday.length === 0 ? (
              <p className="text-sm text-muted">Nothing needs attention right now.</p>
            ) : (
              <>
                {awaitPay.length > 0 && <AttnRow tone="red" title="Awaiting payment" detail={`e.g. ${awaitPay[0].name} · ${awaitPay[0].product}`} count={awaitPay.length} />}
                {noAlloc.length > 0 && <AttnRow tone="gold" title="No batch allocated" detail={`e.g. ${noAlloc[0].name} · ${noAlloc[0].product}`} count={noAlloc.length} />}
                {dueToday.length > 0 && <AttnRow tone="info" title="Delivery today" detail="Scheduled for delivery today" count={dueToday.length} />}
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle label="Production allocation" />
          <div className="space-y-4">
            {PRODUCTS.map((p) => <ProdAllocBar key={p} product={p} reserved={reservedBy(p)} remaining={invBy(p)} />)}
          </div>
        </Card>

        <Card>
          <SectionTitle label="Delivery status" />
          <div className="flex items-center gap-5">
            <Donut total={totalOrders} segments={[
              { value: status.delivered, color: COORD_COLORS.delivered },
              { value: status.ready, color: COORD_COLORS.ready },
              { value: status.allocate, color: COORD_COLORS.allocate },
              { value: status.waiting, color: COORD_COLORS.waiting },
            ]} />
            <div className="space-y-1.5 text-sm">
              <Legend color={COORD_COLORS.delivered} label="Delivered" value={status.delivered} pct={pctOf(status.delivered)} />
              <Legend color={COORD_COLORS.ready} label="Ready for delivery" value={status.ready} pct={pctOf(status.ready)} />
              <Legend color={COORD_COLORS.allocate} label="To allocate" value={status.allocate} pct={pctOf(status.allocate)} />
              <Legend color={COORD_COLORS.waiting} label="Awaiting payment" value={status.waiting} pct={pctOf(status.waiting)} />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle label="Recent orders" action={<Link href="/hatchery/coordination" className="text-xs font-semibold text-gold-dark">View all →</Link>} />
        <TableWrap>
          <thead>
            <tr><Th>Customer</Th><Th>Product</Th><Th className="text-right">Chicks</Th><Th>Delivery date</Th><Th>Payment</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {recent.length === 0 ? <EmptyRow colSpan={6} text="No orders." /> : recent.map((o) => {
              const ps = payState(o);
              const st = o.deliverOk ? "Delivered" : o.allocatedOk ? "Ready" : o.confirmedOk ? "To allocate" : "Awaiting payment";
              const tone = o.deliverOk ? "green" : o.allocatedOk ? "info" : o.confirmedOk ? "gold" : "neutral";
              return (
                <tr key={o.id}>
                  <Td className="font-medium">{o.name}</Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                  <Td>{formatDate(o.date)}</Td>
                  <Td><Pill tone={ps.tone}>{ps.label}</Pill></Td>
                  <Td><Pill tone={tone}>{st}</Pill></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle label="Recent farm visits" action={<Link href="/hatchery/farm-visits" className="text-xs font-semibold text-gold-dark">View all →</Link>} />
          <div className="space-y-1.5 text-sm">
            {visits.length === 0 ? <p className="text-muted">No farm visits logged.</p> : visits.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                <span className="truncate"><strong className="text-ink">{v.customerName}</strong> <span className="text-muted">· {v.product}</span></span>
                <Pill tone={v.sentToSales ? "green" : "gold"}>{v.sentToSales ? "Sent to sales" : "Pending"}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle label="Notifications" />
          <div className="space-y-1.5 text-sm">
            {notifs.length === 0 ? <p className="text-muted">No notifications.</p> : notifs.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                <span className="min-w-0"><span className="text-ink">{n.title}</span> <span className="text-muted">— {n.body}</span></span>
                <span className="shrink-0 text-xs text-muted">{ago(n.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function Legend({ color, label, value, pct }: { color: string; label: string; value: number; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
      <span className="text-ink">{label}</span>
      <span className="text-muted">{value} ({pct}%)</span>
    </div>
  );
}
