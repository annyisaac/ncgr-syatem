"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/Button";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { MultiLineChartView } from "@/components/charts/Charts";
import { formatDateTime } from "@/lib/format";
import { eggsInMachine, isMachineOverTemp } from "@/lib/hatchery/lifecycle";
import { fetchMachineReadings } from "@/lib/hatchery/db";
import type { MachineReading } from "@/lib/hatchery/types";

const RANGES = [
  { key: "24h", label: "24 h", ms: 24 * 3600e3 },
  { key: "7d", label: "7 days", ms: 7 * 24 * 3600e3 },
  { key: "30d", label: "30 days", ms: 30 * 24 * 3600e3 },
  { key: "all", label: "All", ms: Infinity },
] as const;

export default function MachineDetailPage() {
  const params = useParams<{ code: string }>();
  const machineCode = decodeURIComponent(params.code);
  const { user } = useAuth();
  const { machines, batches } = useHatchery();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("7d");
  const [windowed, setWindowed] = useState<MachineReading[]>([]);
  const [loadingReadings, setLoadingReadings] = useState(true);

  const machine = machines.find((m) => m.code === machineCode);

  // Fetch this machine's readings for the selected range on demand (server-side
  // filtered). The global provider only holds a short recent window across every
  // machine, so a machine's full history is loaded here instead.
  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingReadings(true);
    const span = RANGES.find((r) => r.key === range)!.ms;
    const sinceISO = span === Infinity ? undefined : new Date(Date.now() - span).toISOString();
    fetchMachineReadings(machineCode, sinceISO)
      .then((rows) => { if (active) { setWindowed(rows.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))); setLoadingReadings(false); } })
      .catch(() => { if (active) { setWindowed([]); setLoadingReadings(false); } });
    return () => { active = false; };
  }, [machineCode, range]);

  // Charts stay smooth on phones by plotting at most ~300 points — long ranges
  // are evenly downsampled (the shape is preserved; the table below has detail).
  const data = useMemo(() => {
    const step = windowed.length > 300 ? Math.ceil(windowed.length / 300) : 1;
    const sampled = step === 1 ? windowed : windowed.filter((_, i) => i % step === 0);
    return sampled.map((r) => ({
      label: r.timestamp.slice(5, 16).replace("T", " "),
      dry: r.dryF, digitalTemp: r.digitalTempF,
      wet: r.wetF, digitalHumidity: r.digitalHumidityF,
      fan: r.fanSpeed,
    }));
  }, [windowed]);

  if (!user) return null;

  // Attendants record readings but aren't allowed into machine detail/graphs.
  if (user.role === "Hatchery Attendant") {
    return (
      <div className="space-y-4">
        <Link href="/hatchery/machines" className="text-sm text-gold-dark underline">← Back to machines</Link>
        <Card><p className="text-sm text-muted">Machine details aren&apos;t available for your role. You can record machine readings from the Machines page.</p></Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link href="/hatchery/machines" className="text-sm text-gold-dark underline">← Back to machines</Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {machine && <Pill tone={machine.type === "setter" ? "info" : "purple"}>{machine.type} · cap {machine.capacity.toLocaleString()}</Pill>}
      </div>

      {!machine ? (
        <Card><p className="text-sm text-muted">Machine not found.</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Capacity" value={machine.capacity.toLocaleString()} />
            <Stat label="In use" value={eggsInMachine(batches, machine.code, machine.type === "setter" ? "setters" : "transfers").toLocaleString()} />
            <Stat label="Readings (range)" value={loadingReadings ? "…" : String(windowed.length)} />
            <Stat label="Last reading" value={windowed.length ? formatDateTime(windowed[windowed.length - 1].timestamp) : "—"} />
          </div>

          <div className="flex flex-wrap gap-2">
            {RANGES.map((rr) => (
              <Button key={rr.key} size="sm" variant={range === rr.key ? "primary" : "ghost"} onClick={() => setRange(rr.key)}>{rr.label}</Button>
            ))}
          </div>

          <Card>
            <CardHeader title="Temperature — dry & digital (°F)" />
            <MultiLineChartView data={data} series={[
              { key: "dry", name: "Dry °F", color: "#d4a017" },
              { key: "digitalTemp", name: "Digital °F", color: "#b91c1c" },
            ]} />
          </Card>

          <Card>
            <CardHeader title="Humidity — wet (°F) & digital humidity (%)" />
            <MultiLineChartView data={data} series={[
              { key: "wet", name: "Wet °F", color: "#2563eb" },
              { key: "digitalHumidity", name: "Digital humidity %", color: "#15803d" },
            ]} />
          </Card>

          <Card>
            <CardHeader title="Fan speed" />
            <MultiLineChartView data={data} series={[
              { key: "fan", name: "Fan speed", color: "#1c1a16" },
            ]} />
          </Card>

          <Card>
            <CardHeader title={windowed.length > 150 ? `Readings — latest 150 of ${windowed.length.toLocaleString()}` : "Readings in range"} />
            <TableWrap>
              <thead><tr><Th>When</Th><Th className="text-right">Fan</Th><Th className="text-right">Dry°F</Th><Th className="text-right">Wet°F</Th><Th className="text-right">Digital°F</Th><Th className="text-right">Hum%</Th><Th>Operator</Th></tr></thead>
              <tbody>
                {windowed.length === 0 ? <EmptyRow colSpan={7} text={loadingReadings ? "Loading readings…" : "No readings in this range."} /> : windowed.slice().reverse().slice(0, 150).map((rd) => {
                  const hot = isMachineOverTemp(rd.dryF, rd.wetF, rd.digitalTempF);
                  return (
                    <tr key={rd.id}>
                      <Td>{formatDateTime(rd.timestamp)}</Td>
                      <Td className="text-right">{rd.fanSpeed}</Td>
                      <Td className="text-right">{rd.dryF}</Td>
                      <Td className="text-right">{rd.wetF}</Td>
                      <Td className={`text-right ${hot ? "font-bold text-red" : ""}`}>{rd.digitalTempF}</Td>
                      <Td className="text-right">{rd.digitalHumidityF}</Td>
                      <Td>{rd.operator}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-[0.62rem] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
    </Card>
  );
}
