"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { LineChartView } from "@/components/charts/Charts";

import { nowISO, formatDateTime } from "@/lib/format";
import type { MachineReading } from "@/lib/hatchery/types";
import { isOutOfRange, RANGES } from "@/lib/hatchery/lifecycle";

const CAN_LOG = [
  "Admin",
  "Hatchery Manager",
  "Hatchery Operations Manager",
  "Hatchery Attendant",
];

export default function MonitoringPage() {
  const { user } = useAuth();
  const { batches, readings, upsertReading, newId } = useHatchery();
  const { toast } = useToast();

  const activeBatches = useMemo(
    () => batches.filter((b) => b.status === "active"),
    [batches]
  );

  const [batchId, setBatchId] = useState("");
  const [machine, setMachine] = useState<"setter" | "hatcher">("setter");
  const [temp, setTemp] = useState("");
  const [humidity, setHumidity] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canLog = !!user && CAN_LOG.includes(user.role);
  const selBatch = batchId || activeBatches[0]?.id || "";

  const batchReadings = useMemo(
    () =>
      readings
        .filter((r) => r.batchId === selBatch)
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)),
    [readings, selBatch]
  );

  const tempSeries = batchReadings
    .filter((r) => r.machineId === machine)
    .slice(-30)
    .map((r) => ({ label: r.timestamp.slice(11, 16), value: r.temp }));

  if (!user) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!selBatch) return setErr("Select a batch.");
    const t = Number(temp);
    const h = Number(humidity);
    if (!(t > 0)) return setErr("Enter temperature.");
    if (!(h > 0)) return setErr("Enter humidity.");
    const reading: MachineReading = {
      id: newId("read"),
      batchId: selBatch,
      machineId: machine,
      timestamp: nowISO(),
      temp: t,
      humidity: h,
      recordedBy: user!.email,
    };
    upsertReading(reading);
    const flags = isOutOfRange(machine, t, h);
    if (flags.temp || flags.humidity) {
      toast(
        `Recorded — OUT OF RANGE${flags.temp ? " temp" : ""}${flags.humidity ? " humidity" : ""}.`,
        "error"
      );
    } else {
      toast("Reading recorded (in range).");
    }
    setTemp("");
    setHumidity("");
  }

  const r = RANGES[machine];

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Machine Monitoring</h1>

      {canLog && (
        <Card>
          <CardHeader title="Log reading (every 30 min)" />
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="Batch">
              <Select
                value={selBatch}
                onChange={(e) => setBatchId(e.target.value)}
                placeholder={activeBatches.length ? undefined : "No active batches"}
                options={activeBatches.map((b) => ({ value: b.id, label: `${b.batchNo} (${b.productType})` }))}
              />
            </Field>
            <Field label="Machine">
              <Select
                value={machine}
                onChange={(e) => setMachine(e.target.value as "setter" | "hatcher")}
                options={[
                  { value: "setter", label: "Setter" },
                  { value: "hatcher", label: "Hatcher" },
                ]}
              />
            </Field>
            <Field label={`Temp °C (${r.temp[0]}–${r.temp[1]})`}>
              <Input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} />
            </Field>
            <Field label={`Humidity % (${r.humidity[0]}–${r.humidity[1]})`}>
              <Input type="number" step="1" value={humidity} onChange={(e) => setHumidity(e.target.value)} />
            </Field>
            {err && <p className="sm:col-span-4 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-4 flex justify-end">
              <Button type="submit" disabled={!selBatch}>Record reading</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`Temperature trend — ${machine}`}
          action={
            <Select
              value={selBatch}
              onChange={(e) => setBatchId(e.target.value)}
              className="w-56"
              options={batches.map((b) => ({ value: b.id, label: b.batchNo }))}
              placeholder={batches.length ? undefined : "No batches"}
            />
          }
        />
        <LineChartView data={tempSeries} valueName="°C" />
      </Card>

      <Card>
        <CardHeader title="Recent readings" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Machine</Th>
              <Th className="text-right">Temp °C</Th>
              <Th className="text-right">Humidity %</Th>
              <Th>Status</Th>
              <Th>By</Th>
            </tr>
          </thead>
          <tbody>
            {batchReadings.length === 0 ? (
              <EmptyRow colSpan={6} text="No readings for this batch." />
            ) : (
              batchReadings
                .slice()
                .reverse()
                .slice(0, 40)
                .map((rd) => {
                  const flags = isOutOfRange(rd.machineId, rd.temp, rd.humidity);
                  const bad = flags.temp || flags.humidity;
                  return (
                    <tr key={rd.id}>
                      <Td>{formatDateTime(rd.timestamp)}</Td>
                      <Td>{rd.machineId}</Td>
                      <Td className={`text-right ${flags.temp ? "font-bold text-red" : ""}`}>{rd.temp}</Td>
                      <Td className={`text-right ${flags.humidity ? "font-bold text-red" : ""}`}>{rd.humidity}</Td>
                      <Td>{bad ? <Pill tone="red">Out of range</Pill> : <Pill tone="green">In range</Pill>}</Td>
                      <Td>{rd.recordedBy}</Td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
