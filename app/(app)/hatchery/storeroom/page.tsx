"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Td, EmptyRow } from "@/components/ui/Table";
import { MultiLineChartView } from "@/components/charts/Charts";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import type { Reception } from "@/lib/hatchery/types";
import { settableEggs, remainingSettable } from "@/lib/hatchery/lifecycle";

const CAN_LOG = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Attendant"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

const TREND = [{ value: "7", label: "Last 7 Days" }, { value: "14", label: "Last 14 Days" }, { value: "30", label: "Last 30 Days" }];

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
}
function shortDay(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en", { day: "numeric", month: "short" });
}
function ageDays(iso: string): number {
  return Math.max(0, Math.round((new Date(todayISO() + "T00:00:00").getTime() - new Date(iso + "T00:00:00").getTime()) / 86_400_000));
}
function whenLabel(ts: string): string {
  const day = ts.slice(0, 10);
  const time = new Date(ts).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
  return `${day === todayISO() ? "Today" : formatDate(day)}, ${time}`;
}

export default function StoreRoomPage() {
  const { user } = useAuth();
  const { storeReadings, receptions, batches, farms, upsertStoreReading, upsertReception, newId } = useHatchery();
  const { recorder } = useOperator();
  const { toast } = useToast();
  const [temp, setTemp] = useState("");
  const [humidity, setHumidity] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [trendDays, setTrendDays] = useState("7");

  const canLog = !!user && CAN_LOG.includes(user.role);
  const readings = useMemo(() => storeReadings.slice().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)), [storeReadings]);
  const latest = readings[0];
  const farmLoc = (name: string) => farms.find((x) => x.name === name)?.location ?? "";
  const batchNo = (id?: string) => (id ? batches.find((b) => b.id === id)?.batchNo ?? id : null);

  const stored = useMemo(
    () => receptions.filter((r) => r.location === "store" && !r.batchId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [receptions]
  );
  const totalInStore = stored.reduce((s, r) => s + remainingSettable(r), 0);

  // Daily-averaged temperature + humidity over the selected window.
  const trendData = useMemo(() => {
    const cutoff = addDaysISO(todayISO(), -(Number(trendDays) - 1));
    const byDay = new Map<string, { t: number[]; h: number[] }>();
    for (const r of storeReadings) {
      const d = r.timestamp.slice(0, 10);
      if (d < cutoff) continue;
      const g = byDay.get(d) ?? { t: [], h: [] };
      g.t.push(r.temp); g.h.push(r.humidity); byDay.set(d, g);
    }
    const avg = (a: number[]) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0);
    return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, g]) => ({
      label: shortDay(d), temp: Math.round(avg(g.t) * 10) / 10, humidity: Math.round(avg(g.h)),
    }));
  }, [storeReadings, trendDays]);

  if (!user) return null;

  const total = stored.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = stored.slice(start, start + perPage);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const t = Number(temp), h = Number(humidity);
    if (!(t > 0)) return setErr("Enter temperature.");
    if (!(h > 0)) return setErr("Enter humidity.");
    upsertStoreReading({ id: newId("store"), timestamp: nowISO(), temp: t, humidity: h, recordedBy: recorder(user!.email) });
    toast("Store-room reading recorded.");
    setTemp(""); setHumidity("");
  }

  function sendToSetting(r: Reception) {
    upsertReception({ ...r, location: "ready" });
    toast(`${r.farm} · flock ${r.flockId} is now ready to set.`);
  }

  return (
    <div className="space-y-5">
      {/* Eggs in store */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[0.95rem] font-bold text-ink">
            <IcoBox />Eggs in store <span className="text-muted">({totalInStore.toLocaleString()})</span>
          </h2>
          <Link href="/hatchery/inventory" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-gold">Inventory summary</Link>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Received</th>
              <th className={HG}>Farm</th>
              <th className={HG}>Flock</th>
              <th className={HG}>Product</th>
              <th className={`${HG} text-right`}>Settable</th>
              <th className={HG}>Fumigated</th>
              <th className={HG}>Batch</th>
              <th className={`${HG} text-right`}>Age (days)</th>
              <th className={`${HG} text-right`}>Qty in store</th>
              {canLog && <th className={`${HG} last:rounded-tr-lg text-right`}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={canLog ? 10 : 9} text="No receptions in the store room." />
            ) : pageRows.map((r) => {
              const settable = settableEggs(r);
              const fum = r.fumigatedEggs ?? 0;
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDate(r.date)}</Td>
                  <Td><div className="font-semibold text-ink">{r.farm}</div>{farmLoc(r.farm) && <div className="text-xs text-muted">{farmLoc(r.farm)}</div>}</Td>
                  <Td className="whitespace-nowrap font-medium">{r.flockId}</Td>
                  <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: r.productType === "Ross 308" ? "#1565c0" : "#b8860b" }} />{r.productType}</span></Td>
                  <Td className="text-right font-semibold tabular-nums text-green">{settable.toLocaleString()}</Td>
                  <Td>
                    {fum >= settable && settable > 0 ? (
                      <Pill tone="green">Yes</Pill>
                    ) : fum > 0 ? (
                      <span className="inline-flex flex-col gap-0.5"><Pill tone="gold">Partial</Pill><span className="text-[11px] text-muted">{fum.toLocaleString()} fumigated</span></span>
                    ) : (
                      <Pill tone="neutral">No</Pill>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{r.batchId ? <Pill tone="gold" className="whitespace-nowrap">{batchNo(r.batchId)}</Pill> : <span className="text-muted">—</span>}</Td>
                  <Td className="text-right tabular-nums">{ageDays(r.date)}</Td>
                  <Td className="text-right font-semibold tabular-nums">{remainingSettable(r).toLocaleString()}</Td>
                  {canLog && <Td className="text-right"><Button size="sm" onClick={() => sendToSetting(r)}>Send to setting</Button></Td>}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No records" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} records`}</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>‹</Button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, curPage - 3), Math.max(0, curPage - 3) + 5).map((p) => (
                <Button key={p} size="sm" variant={p === curPage ? "primary" : "ghost"} onClick={() => setPage(p)}>{p}</Button>
              ))}
              <Button size="sm" variant="ghost" disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>›</Button>
            </div>
            <label className="flex items-center gap-2">Rows per page:
              <span className="w-20"><Select value={String(perPage)} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))} /></span>
            </label>
          </div>
        </div>
      </Card>

      {/* Log conditions + latest reading */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-[0.95rem] font-bold text-ink"><IcoThermo />Log store-room conditions</h2>
          {canLog ? (
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
              <Field label="Temperature (°F)"><Input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="Enter temperature" /></Field>
              <Field label="Humidity (%)"><Input type="number" step="1" value={humidity} onChange={(e) => setHumidity(e.target.value)} placeholder="Enter humidity" /></Field>
              <Button type="submit">Record</Button>
              {err && <p className="w-full text-sm text-status-refunded">{err}</p>}
            </form>
          ) : (
            <p className="text-sm text-muted">You don&apos;t have permission to log conditions.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-[0.95rem] font-bold text-ink">Latest reading</h2>
          {latest ? (
            <div className="flex flex-wrap items-center gap-6">
              <Reading icon={<IcoThermo />} tone="gold" value={`${latest.temp} °F`} label="Temperature" />
              <Reading icon={<IcoDrop />} tone="blue" value={`${latest.humidity} %`} label="Humidity" />
              <Reading icon={<IcoClock />} tone="default" value={whenLabel(latest.timestamp)} label="Last recorded" />
            </div>
          ) : (
            <p className="text-sm text-muted">No readings recorded yet.</p>
          )}
        </Card>
      </div>

      {/* Temperature trend */}
      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[0.95rem] font-bold text-ink"><IcoChart />Temperature trend</h2>
          <div className="w-36"><Select value={trendDays} onChange={(e) => setTrendDays(e.target.value)} options={TREND} /></div>
        </div>
        <MultiLineChartView
          data={trendData}
          series={[
            { key: "temp", name: "Temperature (°F)", color: "#d6a020" },
            { key: "humidity", name: "Humidity (%)", color: "#2e7d32" },
          ]}
        />
      </Card>
    </div>
  );
}

// ---- reading tile + icons -------------------------------------------------

type Tone = "gold" | "blue" | "green" | "default";
const CHIP: Record<Tone, string> = {
  gold: "bg-gold-bg text-gold-dark", blue: "bg-blue-bg text-blue", green: "bg-green-bg text-green", default: "bg-grey-bg text-ink",
};
function Reading({ icon, value, label, tone }: { icon: ReactNode; value: string; label: string; tone: Tone }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${CHIP[tone]}`}>{icon}</span>
      <div>
        <p className="text-[1.15rem] font-extrabold leading-none tabular-nums text-ink">{value}</p>
        <p className="mt-1 text-[0.62rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      </div>
    </div>
  );
}

const ssvg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoBox = () => <span className="text-gold-dark">{ssvg(<><path d="M4 8l8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /></>)}</span>;
const IcoThermo = () => ssvg(<><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z" /><path d="M12 9v6" /></>);
const IcoDrop = () => ssvg(<path d="M12 3s6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 6-10 6-10Z" />);
const IcoClock = () => ssvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoChart = () => <span className="text-gold-dark">{ssvg(<path d="M4 19V5M4 19h16M8 15l3-4 3 3 4-6" />)}</span>;
