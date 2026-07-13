"use client";

/**
 * Lazy chart wrappers. Recharts (with its D3 dependencies) is one of the
 * heaviest libraries in the app, and it was previously bundled into every page
 * that shows a chart — including the dashboard, the first screen most users
 * hit. Here we code-split it: the actual implementations in `ChartsImpl` load
 * on the client only when a chart is about to render, so the initial page load
 * is much lighter. A pulse placeholder shows while the chunk streams in.
 */

import dynamic from "next/dynamic";

function Placeholder() {
  return <div className="h-64 w-full animate-pulse rounded bg-ink/5" />;
}

export const BarChartView = dynamic(
  () => import("./ChartsImpl").then((m) => m.BarChartView),
  { ssr: false, loading: Placeholder }
);
export const LineChartView = dynamic(
  () => import("./ChartsImpl").then((m) => m.LineChartView),
  { ssr: false, loading: Placeholder }
);
export const MultiLineChartView = dynamic(
  () => import("./ChartsImpl").then((m) => m.MultiLineChartView),
  { ssr: false, loading: Placeholder }
);
export const PieChartView = dynamic(
  () => import("./ChartsImpl").then((m) => m.PieChartView),
  { ssr: false, loading: Placeholder }
);

export type { BarDatum, Series, PieDatum } from "./ChartsImpl";
