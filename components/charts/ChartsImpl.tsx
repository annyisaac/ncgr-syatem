"use client";

/**
 * Recharts implementations. This module is heavy (recharts pulls in D3), so it
 * is NOT imported directly by pages — `Charts.tsx` lazy-loads it via
 * next/dynamic so recharts stays out of the initial bundle.
 *
 * Charts render only after mount (client-only) to avoid SSR/window issues.
 */

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const GOLD = "#d4a017";
const INK = "#1c1a16";

/** Compact axis numbers, e.g. 270000 -> 270k, 1500000 -> 1.5M. */
function compact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${+(v / 1_000).toFixed(1)}k`;
  return String(v);
}
const PIE_COLORS = ["#d4a017", "#1c1a16", "#15803d", "#b45309", "#2563eb", "#b91c1c"];

function useMounted() {
  const [m, setM] = useState(false);
  // Deliberate SSR gate: charts must only render after mount (recharts
  // measures the DOM), so this one-time flip is intended.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setM(true), []);
  return m;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

function Placeholder() {
  return <div className="h-64 w-full animate-pulse rounded bg-ink/5" />;
}

export interface BarDatum {
  label: string;
  value: number;
}

export function BarChartView({
  data,
  color = GOLD,
  valueName = "Value",
}: {
  data: BarDatum[];
  color?: string;
  valueName?: string;
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder />;
  if (data.length === 0)
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink/40">
        No data
      </div>
    );
  return (
    <Frame>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7e4dc" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: INK }}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={60}
        />
        <YAxis tick={{ fontSize: 11, fill: INK }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="value" name={valueName} fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </Frame>
  );
}

export function LineChartView({
  data,
  color = GOLD,
  valueName = "Value",
}: {
  data: BarDatum[];
  color?: string;
  valueName?: string;
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder />;
  if (data.length === 0)
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink/40">
        No data
      </div>
    );
  return (
    <Frame>
      <LineChart data={data} margin={{ top: 12, right: 14, bottom: 8, left: 0 }}>
        <CartesianGrid
          vertical={false}
          stroke="rgba(124,118,106,0.22)"
          strokeWidth={1}
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#7c766a" }}
          interval="preserveStartEnd"
          axisLine={false}
          tickLine={false}
          angle={-20}
          textAnchor="end"
          height={52}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#7c766a" }}
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={compact}
        />
        <Tooltip />
        <Line
          type="natural"
          dataKey="value"
          name={valueName}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          activeDot={{ r: 5, strokeWidth: 0 }}
        />
      </LineChart>
    </Frame>
  );
}

export interface Series {
  key: string;
  name: string;
  color: string;
}

/** Multi-series line chart keyed by `label`, one <Line> per series. */
export function MultiLineChartView({
  data,
  series,
  height = 240,
}: {
  data: Record<string, number | string>[];
  series: Series[];
  height?: number;
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder />;
  if (data.length === 0)
    return (
      <div className="flex h-60 items-center justify-center text-sm text-ink/40">
        No data
      </div>
    );
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 14, bottom: 8, left: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(124,118,106,0.22)" strokeWidth={1} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#7c766a" }}
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
            angle={-20}
            textAnchor="end"
            height={52}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#7c766a" }}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={compact}
            domain={["auto", "auto"]}
          />
          <Tooltip />
          <Legend />
          {series.map((s) => (
            <Line
              key={s.key}
              type="natural"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2.5}
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface PieDatum {
  label: string;
  value: number;
}

/** Donut with custom colours and a centered label (legend is rendered by the caller). */
export function DonutChartView({
  data,
  colors,
  centerLabel,
  centerSub,
}: {
  data: PieDatum[];
  colors: string[];
  centerLabel: string;
  centerSub?: string;
}) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder />;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0)
    return <div className="flex h-64 items-center justify-center text-sm text-ink/40">No data</div>;
  return (
    <div className="relative h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={66} outerRadius={94} paddingAngle={2} stroke="none">
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-base font-bold text-ink">{centerLabel}</span>
        {centerSub && <span className="text-[0.7rem] text-muted">{centerSub}</span>}
      </div>
    </div>
  );
}

export function PieChartView({ data }: { data: PieDatum[] }) {
  const mounted = useMounted();
  if (!mounted) return <Placeholder />;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0)
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink/40">
        No data
      </div>
    );
  return (
    <Frame>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={(e: { name?: string; value?: number }) =>
            `${e.name ?? ""}: ${e.value ?? 0}`
          }
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </Frame>
  );
}
