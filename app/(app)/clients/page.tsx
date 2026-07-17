"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Select";
import { DateRange, ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { Kpi } from "@/components/dashboard/Kpi";
import { useToast } from "@/components/ui/Toast";
import { visibleOrders } from "@/lib/permissions";
import { formatRWF } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { buildClients } from "@/lib/clients";
import { exportClientsExcel } from "@/lib/reports";

/** Human label for the selected date range, used in the file name + heading. */
function rangeLabel(r: DateRangeValue): string {
  if (!r.from && !r.to) return "All time";
  if (r.from && r.to) return `${r.from} to ${r.to}`;
  if (r.from) return `from ${r.from}`;
  return `up to ${r.to}`;
}

export default function ClientsPage() {
  const { user } = useAuth();
  const { orders } = useData();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);
  const [downloading, setDownloading] = useState(false);

  // Clients are built from the orders in the selected delivery-date range, so
  // every total (chicks, paid, balance) reflects exactly that period.
  const clients = useMemo(() => {
    if (!user) return [];
    const vis = visibleOrders(orders, user);
    const ranged = !range.from && !range.to ? vis : vis.filter((o) => inRange(o.date, range));
    return buildClients(ranged);
  }, [orders, user, range]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(s) || c.phone.toLowerCase().includes(s) || c.districts.some((d) => d.toLowerCase().includes(s)));
  }, [clients, q]);

  if (!user) return null;

  const isAdmin = user.role === "Admin";
  const totalChicks = clients.reduce((s, c) => s + c.chicks, 0);
  const totalBalance = clients.reduce((s, c) => s + c.balance, 0);

  async function downloadClients() {
    if (user?.role !== "Admin") return; // download is Admin-only
    if (filtered.length === 0) {
      toast("No clients to download for this selection.", "info");
      return;
    }
    setDownloading(true);
    try {
      const label = q.trim() ? `${rangeLabel(range)} (${q.trim()})` : rangeLabel(range);
      await exportClientsExcel(filtered, label);
      toast(`Downloaded ${filtered.length} client${filtered.length === 1 ? "" : "s"}.`);
    } catch {
      toast("Could not build the download.", "error");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Clients</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Clients" value={String(clients.length)} />
        <Kpi label="Chicks ordered" value={totalChicks.toLocaleString()} />
        <Kpi label="Outstanding balance" value={formatRWF(totalBalance)} tone={totalBalance > 0 ? "red" : "default"} />
        <Kpi label="Orders" value={String(clients.reduce((s, c) => s + c.ordersCount, 0))} />
      </div>

      <Card>
        <CardHeader
          title="Client list"
          action={
            isAdmin ? (
              <Button size="sm" onClick={downloadClients} disabled={downloading}>
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                  <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15h12" />
                </svg>
                {downloading ? "Preparing…" : "Download"}
              </Button>
            ) : undefined
          }
        />
        {/* Time range for the client totals + the download. */}
        <div className="mb-3">
          <DateRange value={range} onChange={setRange} />
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients — name, phone, district…" />
        <div className="mt-3">
          <TableWrap>
            <thead>
              <tr>
                <Th>Client</Th><Th>Phone</Th><Th>District(s)</Th>
                <Th className="text-right">Orders</Th><Th className="text-right">Chicks</Th>
                <Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Last order</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={8} text={q || range.from || range.to ? "No clients match this selection." : "No clients yet."} />
              ) : filtered.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/clients/${encodeURIComponent(c.id)}`} className="font-medium text-gold-dark underline underline-offset-2">{c.name}</Link>
                  </Td>
                  <Td>{c.phone || "—"}</Td>
                  <Td>{c.districts.join(", ") || "—"}</Td>
                  <Td className="text-right">{c.ordersCount}</Td>
                  <Td className="text-right">{c.chicks.toLocaleString()}</Td>
                  <Td className="text-right">{formatRWF(c.paid)}</Td>
                  <Td className={`text-right ${c.balance > 0 ? "font-semibold text-red" : ""}`}>{formatRWF(c.balance)}</Td>
                  <Td>{c.lastOrder ? formatDate(c.lastOrder) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </Card>
    </div>
  );
}
