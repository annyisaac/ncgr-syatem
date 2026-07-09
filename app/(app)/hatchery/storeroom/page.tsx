"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { LineChartView } from "@/components/charts/Charts";
import { nowISO, formatDate, formatDateTime } from "@/lib/format";
import type { Reception, StoreReading } from "@/lib/hatchery/types";
import { settableEggs } from "@/lib/hatchery/lifecycle";

const CAN_LOG = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Attendant"];

export default function StoreRoomPage() {
  const { user } = useAuth();
  const { storeReadings, receptions, upsertStoreReading, upsertReception, newId } = useHatchery();
  const { recorder } = useOperator();
  const { toast } = useToast();
  const [temp, setTemp] = useState("");
  const [humidity, setHumidity] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canLog = !!user && CAN_LOG.includes(user.role);
  const rows = useMemo(() => storeReadings.slice().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)), [storeReadings]);
  const series = rows.slice(0, 30).reverse().map((r) => ({ label: r.timestamp.slice(5, 16).replace("T", " "), value: r.temp }));

  const stored = useMemo(
    () => receptions.filter((r) => r.location === "store" && !r.batchId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [receptions]
  );

  if (!user) return null;

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
      <h1 className="section-heading text-lg">Store Room</h1>

      <Card>
        <CardHeader title={`Eggs in store (${stored.length})`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Received</Th><Th>Farm</Th><Th>Flock</Th><Th>Product</Th>
              <Th className="text-right">Settable</Th><Th className="text-right">Fumigated</Th><Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {stored.length === 0 ? (
              <EmptyRow colSpan={7} text="No receptions in the store room." />
            ) : (
              stored.map((r) => {
                const settable = settableEggs(r);
                const fum = r.fumigatedEggs ?? 0;
                return (
                  <tr key={r.id}>
                    <Td>{formatDate(r.date)}</Td>
                    <Td>{r.farm}</Td>
                    <Td>{r.flockId}</Td>
                    <Td>{r.productType}</Td>
                    <Td className="text-right font-semibold">{settable.toLocaleString()}</Td>
                    <Td className="text-right">
                      {fum > 0 ? <Pill tone={fum >= settable ? "green" : "gold"}>{fum.toLocaleString()}</Pill> : <Pill tone="neutral">none</Pill>}
                    </Td>
                    <Td>{canLog && <Button size="sm" onClick={() => sendToSetting(r)}>Send to setting</Button>}</Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {canLog && (
        <Card>
          <CardHeader title="Log store-room conditions" />
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Temperature (°F)"><Input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} /></Field>
            <Field label="Humidity (%)"><Input type="number" step="1" value={humidity} onChange={(e) => setHumidity(e.target.value)} /></Field>
            <div className="flex items-end"><Button type="submit">Record</Button></div>
            {err && <p className="sm:col-span-3 text-sm text-status-refunded">{err}</p>}
          </form>
        </Card>
      )}
      <Card>
        <CardHeader title="Temperature trend" />
        <LineChartView data={series} valueName="°F" />
      </Card>
      <Card>
        <CardHeader title="Recent readings" />
        <TableWrap>
          <thead><tr><Th>When</Th><Th className="text-right">Temp °F</Th><Th className="text-right">Humidity %</Th><Th>By</Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={4} text="No readings yet." /> : rows.slice(0, 40).map((r) => (
              <tr key={r.id}><Td>{formatDateTime(r.timestamp)}</Td><Td className="text-right">{r.temp}</Td><Td className="text-right">{r.humidity}</Td><Td>{r.recordedBy}</Td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
