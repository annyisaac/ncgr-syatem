"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { availableFor, toDeliver } from "@/lib/types";
import { getSupabase } from "@/lib/supabase";
import { listAgentQuotas, upsertAgentQuota, quotaId, type AgentQuota } from "@/lib/quota";

const isActive = (s?: string) => s !== "refunded" && s !== "rejected";

export default function AgentQuotasPage() {
  const { user } = useAuth();
  const { users, orders, availability } = useData();
  const { toast } = useToast();

  const [quotas, setQuotas] = useState<AgentQuota[]>([]);
  const [agent, setAgent] = useState("");
  const [date, setDate] = useState("");
  const [chicks, setChicks] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canManage = user?.role === "Admin";

  const load = useCallback(async () => {
    try { setQuotas(await listAgentQuotas()); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canManage) void load(); }, [load, canManage]);
  useEffect(() => {
    if (!canManage) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("agent-quotas-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "agent_quotas") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canManage, load]);

  const agents = useMemo(() => users.filter((u) => u.role === "Ross Sales Agent" && u.active).sort((a, b) => a.name.localeCompare(b.name)), [users]);
  const openDates = useMemo(
    () => availability.filter((a) => !a.closed && a.date >= todayISO() && a.ross > 0).sort((a, b) => (a.date < b.date ? -1 : 1)),
    [availability]
  );

  // Chicks an agent has already sold on a date (their own active Ross orders).
  const soldBy = useMemo(() => (email: string, d: string) =>
    orders.filter((o) => o.date === d && o.product === "Ross 308" && isActive(o.status) && (o.by ?? "").toLowerCase() === email.toLowerCase()).reduce((s, o) => s + toDeliver(o), 0),
    [orders]);

  const rows = useMemo(() => quotas.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.agentEmail.localeCompare(b.agentEmail))), [quotas]);
  const nameOf = (email: string) => agents.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name ?? email;

  // Total allocated to all agents on the selected date vs the date's Ross cap.
  const selAvail = availability.find((a) => a.id === date);
  const allocatedOnDate = quotas.filter((q) => q.date === date).reduce((s, q) => s + q.chicks, 0);

  if (!user) return null;
  if (!canManage) return <Card><p className="text-sm text-muted">Only the Admin can assign agent quotas.</p></Card>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!agent) return setErr("Choose an agent.");
    if (!date) return setErr("Choose a delivery date.");
    const n = Math.max(0, Math.round(Number(chicks) || 0));
    if (n <= 0) return setErr("Enter the number of chicks to allocate.");
    const q: AgentQuota = { id: quotaId(agent, date), agentEmail: agent.toLowerCase(), date, chicks: n, by: user!.email, on: nowISO() };
    // Optimistic
    setQuotas((p) => { const i = p.findIndex((x) => x.id === q.id); const c = p.slice(); if (i === -1) c.push(q); else c[i] = q; return c; });
    try {
      await upsertAgentQuota(q);
      toast(`Allocated ${n.toLocaleString()} chicks to ${nameOf(agent)} on ${formatDate(date)}.`);
    } catch { toast("Could not save the quota.", "error"); void load(); }
    setChicks("");
  }

  const totalAllocated = quotas.reduce((s, q) => s + q.chicks, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Agent quotas</h1>
        <p className="mt-1 text-sm text-muted">Give each Ross 308 field agent a number of chicks to sell on a delivery date.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Ross field agents" value={String(agents.length)} />
        <StatTile label="Allocations" value={String(quotas.length)} />
        <StatTile label="Chicks allocated" value={totalAllocated.toLocaleString()} tone="green" />
      </div>

      <Card>
        <CardHeader title="Allocate chicks" />
        {agents.length === 0 ? (
          <p className="text-sm text-muted">No Ross Sales Agent accounts yet. Create one on the Users page (role “Ross Sales Agent”).</p>
        ) : (
          <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="Agent"><Select value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Select agent" options={agents.map((u) => ({ value: u.email, label: u.name }))} /></Field>
            <Field label="Delivery date"><Select value={date} onChange={(e) => setDate(e.target.value)} placeholder={openDates.length ? "Select date" : "No open Ross dates"} options={openDates.map((a) => ({ value: a.id, label: `${formatDate(a.date)} · ${availableFor(a, "Ross 308", orders).toLocaleString()} date-left` }))} /></Field>
            <Field label="Chicks to sell"><Input type="number" min={1} value={chicks} onChange={(e) => setChicks(e.target.value)} /></Field>
            <div className="flex items-end"><Button type="submit">Allocate</Button></div>
            {date && selAvail && (
              <div className="sm:col-span-4 -mt-1 text-xs text-muted">
                {formatDate(date)}: Ross capacity <strong className="text-ink">{selAvail.ross.toLocaleString()}</strong> · already allocated to agents <strong className="text-ink">{allocatedOnDate.toLocaleString()}</strong>
                {allocatedOnDate > selAvail.ross && <span className="text-red"> — over the date capacity</span>}
              </div>
            )}
            {err && <p className="sm:col-span-4 text-sm text-status-refunded">{err}</p>}
          </form>
        )}
      </Card>

      <Card>
        <CardHeader title={`Allocations (${rows.length})`} />
        <TableWrap>
          <thead><tr><Th>Delivery date</Th><Th>Agent</Th><Th className="text-right">Allocated</Th><Th className="text-right">Sold</Th><Th className="text-right">Left</Th><Th></Th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} text="No allocations yet." />
            ) : rows.map((q) => {
              const sold = soldBy(q.agentEmail, q.date);
              const left = Math.max(0, q.chicks - sold);
              const past = q.date < todayISO();
              return (
                <tr key={q.id} className={past ? "opacity-60" : undefined}>
                  <Td className="whitespace-nowrap font-medium">{formatDate(q.date)}</Td>
                  <Td>{nameOf(q.agentEmail)}</Td>
                  <Td className="text-right tabular-nums">{q.chicks.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{sold.toLocaleString()}</Td>
                  <Td className="text-right"><Pill tone={left > 0 ? "green" : "neutral"}>{left.toLocaleString()}</Pill></Td>
                  <Td className="text-right">{!past && <Button size="sm" variant="ghost" onClick={() => { setAgent(q.agentEmail); setDate(q.date); setChicks(String(q.chicks)); }}>Edit</Button>}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
