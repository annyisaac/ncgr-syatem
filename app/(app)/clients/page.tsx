"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/cn";
import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Pagination } from "@/components/ui/Pagination";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { SearchTimeBar } from "@/components/dashboard/DashKit";
import { Kpi } from "@/components/dashboard/Kpi";
import { ClientFormModal } from "@/components/clients/ClientFormModal";
import { useToast } from "@/components/ui/Toast";
import { visibleOrders, productForRole, clientVisible, canWriteClients } from "@/lib/permissions";
import { smartMatch, suggest } from "@/lib/search";
import { formatRWF } from "@/lib/config";
import { formatDate, todayISO, nowISO } from "@/lib/format";
import { presetToRange, type PeriodPreset } from "@/lib/period";
import { buildClients, materializeClient, planDueSoon, type ClientRecord } from "@/lib/clients";
import { exportClientsExcel } from "@/lib/reports";
import type { Client } from "@/lib/types";

/** Human label for the selected date range, used in the file name + heading. */
function rangeLabel(r: DateRangeValue): string {
  if (!r.from && !r.to) return "All time";
  if (r.from && r.to) return `${r.from} to ${r.to}`;
  if (r.from) return `from ${r.from}`;
  return `up to ${r.to}`;
}

type TabKey = "all" | "special" | "active" | "owing" | "prepaid" | "inactive";

export default function ClientsPage() {
  const { user } = useAuth();
  const { orders, clients, removeClient, upsertClient } = useData();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const range = presetToRange(preset, custom, todayISO());
  const [tab, setTab] = useState<TabKey>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [downloading, setDownloading] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  // Clients are built from the orders in the selected delivery-date range, then
  // the standalone client records are merged on top (so a client with no order
  // still shows). Every total reflects exactly that period.
  const all = useMemo(() => {
    if (!user) return [];
    const vis = visibleOrders(orders, user);
    const ranged = !range.from && !range.to ? vis : vis.filter((o) => inRange(o.date, range));
    const visibleClients = clients.filter((c) => clientVisible(c, user));
    return buildClients(ranged, visibleClients);
  }, [orders, clients, user, range]);

  const byTab = useMemo(() => {
    switch (tab) {
      case "special": return all.filter((c) => c.special);
      case "active": return all.filter((c) => c.active);
      case "inactive": return all.filter((c) => !c.active);
      case "owing": return all.filter((c) => c.balance > 0);
      case "prepaid": return all.filter((c) => c.balance < 0);
      default: return all;
    }
  }, [all, tab]);

  const filtered = useMemo(() => {
    if (!q.trim()) return byTab;
    return byTab.filter((c) => smartMatch(q, c.name, c.phone, c.districts.join(" ")));
  }, [byTab, q]);

  const searchSuggestions = useMemo(() => suggest(q, all, (c) => c.name, 6), [q, all]);

  // Special clients with a planned delivery date within a week and no order yet.
  const planDue = useMemo(() => planDueSoon(all, 7), [all]);

  // Any filter change returns to the first page so the view never lands on an
  // empty page past the new end.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [tab, q, preset, custom, pageSize]);

  if (!user) return null;

  const isAdmin = user.role === "Admin";
  const canWrite = canWriteClients(user.role);

  const totalChicks = all.reduce((s, c) => s + c.chicks, 0);
  const outstanding = all.reduce((s, c) => s + Math.max(0, c.balance), 0);
  const totalOrders = all.reduce((s, c) => s + c.ordersCount, 0);
  const owingCount = all.filter((c) => c.balance > 0).length;

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: all.length },
    { key: "special", label: "★ Special", count: all.filter((c) => c.special).length },
    { key: "active", label: "Active", count: all.filter((c) => c.active).length },
    { key: "owing", label: "Owing", count: owingCount },
    { key: "prepaid", label: "Prepaid", count: all.filter((c) => c.balance < 0).length },
    { key: "inactive", label: "Inactive", count: all.filter((c) => !c.active).length },
  ];

  const total = filtered.length;
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  async function downloadClients() {
    if (!isAdmin) return; // download is Admin-only
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

  function clearFilters() {
    setQ("");
    setPreset("all");
    setCustom(ALL_TIME);
    setTab("all");
  }

  // Prefilled new-order form for a client's planned date + chicks.
  function planOrderHref(c: ClientRecord, date: string, chicks: number): string {
    const prod = c.product ?? c.orders[0]?.product;
    const params = new URLSearchParams({ phone: c.phone, name: c.name, date, chicks: String(chicks) });
    if (prod === "Ross 308" || prod === "Tetra Super Harco") params.set("product", prod);
    return `/orders/new?${params.toString()}`;
  }

  // One-click ★ toggle — materialises a client record if this client has none
  // yet (derived purely from orders), so it persists.
  async function toggleSpecial(c: ClientRecord) {
    if (!canWrite) return;
    const base = materializeClient(c, user!.email);
    const now = !base.special;
    const next: Client = {
      ...base,
      special: now,
      specialBy: now ? user!.email : base.specialBy,
      specialOn: now ? nowISO() : base.specialOn,
    };
    try {
      await upsertClient(next);
      toast(now ? `${c.name} marked as special ★` : `${c.name} is no longer special.`);
    } catch {
      toast("Could not update the client.", "error");
    }
  }

  function openNew() {
    setEditing({
      id: "", name: "", phone: "", district: "", sector: "",
      product: productForRole(user!.role),
      zone: user!.role === "Tetra Zone Manager" ? user!.zone : undefined,
      active: true, by: user!.email, on: nowISO(),
    });
  }

  function openEdit(c: ClientRecord) {
    setEditing(c.record ?? {
      id: c.id, name: c.name, phone: c.phone,
      district: c.districts[0] ?? "", sector: c.sectors[0] ?? "",
      product: c.product ?? productForRole(user!.role),
      zone: c.zone ?? (user!.role === "Tetra Zone Manager" ? user!.zone : undefined),
      active: c.active, by: user!.email, on: nowISO(),
    });
  }

  async function remove(c: ClientRecord) {
    if (!c.record) return;
    if (!window.confirm(`Remove ${c.name} from the client list? Their orders are not affected.`)) return;
    try {
      await removeClient(c.record.id);
      toast("Client removed.");
    } catch {
      toast("Could not remove the client.", "error");
    }
  }

  const iconBtn = "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:border-ink hover:text-ink";

  return (
    <div className="space-y-5">
      <div className="sticky top-16 z-20 -mx-4 md:-mx-8 border-b border-line bg-cream/95 px-4 md:px-8 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchTimeBar
              q={q}
              setQ={setQ}
              placeholder="Search clients — name, phone, district…"
              preset={preset}
              setPreset={setPreset}
              custom={custom}
              setCustom={setCustom}
              suggestions={searchSuggestions}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
              <path d="M4 4l12 12M16 4L4 16" />
            </svg>
            Clear
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon="users" tone="gold" label="Clients" value={String(all.length)} sub="Total clients" />
        <Kpi icon="chicks" tone="amber" label="Chicks ordered" value={totalChicks.toLocaleString()} sub="Total chicks ordered" />
        <Kpi
          icon="money"
          tone={outstanding > 0 ? "red" : "green"}
          label="Outstanding balance"
          value={formatRWF(outstanding)}
          sub={`${owingCount} client${owingCount === 1 ? "" : "s"} with outstanding balance`}
        />
        <Kpi icon="orders" tone="purple" label="Orders" value={String(totalOrders)} sub="Total orders" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                tab === tb.key ? "bg-gold text-[#231b04]" : "text-muted hover:bg-grey-bg"
              )}
            >
              {tb.label}
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[0.68rem] font-semibold tabular-nums",
                  tab === tb.key ? "bg-[#231b04]/15 text-[#231b04]" : "bg-grey-bg text-muted"
                )}
              >
                {tb.count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={downloadClients} disabled={downloading}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15h12" />
              </svg>
              {downloading ? "Preparing…" : "Export Excel"}
            </Button>
          )}
          {canWrite && (
            <Button size="sm" onClick={openNew}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                <path d="M10 4v12M4 10h12" />
              </svg>
              Add New Client
            </Button>
          )}
        </div>
      </div>

      {canWrite && planDue.length > 0 && (
        <div className="rounded-xl border border-gold/40 bg-gold-bg/40 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 text-gold-dark" aria-hidden>★</span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-ink">
                {planDue.length} special-client plan{planDue.length === 1 ? "" : "s"} due within a week — no order yet
              </p>
              <ul className="mt-1 space-y-0.5 text-ink">
                {planDue.slice(0, 6).map((d) => (
                  <li key={`${d.client.id}|${d.date}`} className="flex flex-wrap items-center gap-x-2">
                    <span>
                      <Link href={`/clients/${encodeURIComponent(d.client.id)}`} className="font-medium text-gold-dark hover:underline">{d.client.name}</Link>
                      {" · "}{formatDate(d.date)} — planned {d.planned.toLocaleString()}
                      {d.ordered > 0 ? `, ordered ${d.ordered.toLocaleString()}` : ", not ordered"}
                    </span>
                    {canWrite && (
                      <Link href={planOrderHref(d.client, d.date, d.planned)} className="text-xs font-semibold text-gold-dark underline">
                        Create order
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              {planDue.length > 6 && <p className="mt-1 text-xs text-muted">+{planDue.length - 6} more…</p>}
            </div>
          </div>
        </div>
      )}

      <Card>
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded bg-gold" />
          <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.09em] text-muted">Client list</h2>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <Th>Client</Th><Th>Phone</Th><Th>District(s)</Th>
              <Th className="text-right">Orders</Th><Th className="text-right">Chicks</Th>
              <Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Last order</Th>
              <Th>Status</Th><Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={10} text={q || tab !== "all" || range.from || range.to ? "No clients match this selection." : "No clients yet."} />
            ) : pageRows.map((c) => (
              <tr key={c.id}>
                <Td>
                  <span className="inline-flex items-center gap-1.5">
                    {c.special && <span className="text-gold-dark" title="Special / key client" aria-label="Special client">★</span>}
                    <Link href={`/clients/${encodeURIComponent(c.id)}`} className="font-medium text-gold-dark">{c.name}</Link>
                  </span>
                </Td>
                <Td>{c.phone || "—"}</Td>
                <Td>{c.districts.join(", ") || "—"}</Td>
                <Td className="text-right">{c.ordersCount}</Td>
                <Td className="text-right">{c.chicks.toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(c.paid)}</Td>
                <Td className={`text-right ${c.balance > 0 ? "font-semibold text-red" : ""}`}>{formatRWF(c.balance)}</Td>
                <Td>{c.lastOrder ? formatDate(c.lastOrder) : "—"}</Td>
                <Td>
                  {c.balance > 0 ? <Pill tone="red">Owing</Pill> : c.balance < 0 ? <Pill tone="info">Prepaid</Pill> : <Pill tone="green">Paid</Pill>}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    <Link href={`/clients/${encodeURIComponent(c.id)}`} title="View client" className={iconBtn}>
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 10S5 4.5 10 4.5 17.5 10 17.5 10 15 15.5 10 15.5 2.5 10 2.5 10Z" /><circle cx="10" cy="10" r="2.2" />
                      </svg>
                    </Link>
                    {canWrite && (
                      <button
                        type="button"
                        title={c.special ? "Unmark special" : "Mark as special"}
                        onClick={() => toggleSpecial(c)}
                        className={cn(iconBtn, c.special ? "border-gold text-gold-dark" : "hover:border-gold hover:text-gold-dark")}
                      >
                        <svg width="16" height="16" viewBox="0 0 20 20" fill={c.special ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 2.5l2.2 4.6 5 .7-3.6 3.5.9 5L10 13.9 5.5 16.3l.9-5L2.8 7.8l5-.7z" />
                        </svg>
                      </button>
                    )}
                    {canWrite && (
                      <button type="button" title="Edit client" onClick={() => openEdit(c)} className={iconBtn}>
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13.5 3.5l3 3L7 16l-3.5.5L4 13z" />
                        </svg>
                      </button>
                    )}
                    {isAdmin && c.record && (
                      <button type="button" title="Remove client" onClick={() => remove(c)} className={cn(iconBtn, "hover:border-red hover:text-red")}>
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 6h12M8 6V4.5h4V6M6 6l.6 9.5h6.8L14 6" />
                        </svg>
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {total > 0 && (
          <div className="mt-3">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              noun="clients"
            />
          </div>
        )}
      </Card>

      {editing && <ClientFormModal key={editing.id || "new"} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
