"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { formatDate, normalizePhone } from "@/lib/format";
import { formatRWF } from "@/lib/config";
import { balance } from "@/lib/types";
import type { DSR, Order, Route } from "@/lib/types";

interface Customer {
  key: string;
  name: string;
  phone: string;
  orders: Order[];
  chicks: number;
  districts: string[];
}

/** Build customer records from orders, keyed by phone number. */
function buildCustomers(orders: Order[]): Customer[] {
  const map = new Map<string, Customer>();
  for (const o of orders) {
    const key = normalizePhone(o.phone) || o.name.trim().toLowerCase();
    if (!key) continue;
    const c = map.get(key) ?? { key, name: o.name, phone: o.phone, orders: [], chicks: 0, districts: [] };
    c.orders.push(o);
    c.chicks += o.chicks;
    if (o.district && !c.districts.includes(o.district)) c.districts.push(o.district);
    // keep the most recent name
    c.name = o.name;
    map.set(key, c);
  }
  return [...map.values()];
}

export function GlobalSearch({ orders, dsrs, routes }: { orders: Order[]; dsrs: DSR[]; routes: Route[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const query = q.trim().toLowerCase();

  const customers = useMemo(() => buildCustomers(orders), [orders]);

  const results = useMemo(() => {
    if (!query) return null;
    const hit = (s?: string) => (s ?? "").toLowerCase().includes(query);
    return {
      customers: customers
        .filter((c) => hit(c.name) || hit(c.phone))
        .slice(0, 12),
      dsrs: dsrs.filter((d) => hit(d.name) || hit(d.phone) || hit(d.district)).slice(0, 8),
      routes: routes.filter((r) => hit(r.name) || hit(r.driver)).slice(0, 8),
      orders: orders
        .filter((o) => hit(o.name) || hit(o.phone) || hit(o.product) || hit(o.district) || hit(o.sector) || hit(o.id))
        .slice(0, 10),
    };
  }, [query, customers, dsrs, routes, orders]);

  const total = results ? results.customers.length + results.dsrs.length + results.routes.length : 0;

  return (
    <Card>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search everything — customers, phone, DSR, route, district…"
        className="text-[0.95rem]"
      />

      {results && (
        <div className="mt-3 space-y-4">
          {total === 0 && <p className="text-sm text-muted">No matches for “{q}”.</p>}

          {/* Customers */}
          {results.customers.length > 0 && (
            <Section title={`Customers (${results.customers.length})`}>
              {results.customers.map((c) => (
                <div key={c.key} className="rounded-lg border border-line">
                  <button
                    onClick={() => setOpen(open === c.key ? null : c.key)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <span className="font-semibold text-ink">{c.name} <span className="font-normal text-muted">· {c.phone}</span></span>
                    <span className="text-xs text-muted">
                      {c.orders.length} order{c.orders.length > 1 ? "s" : ""} · {c.chicks.toLocaleString()} chicks
                      {c.districts.length ? ` · ${c.districts.join(", ")}` : ""}
                    </span>
                  </button>
                  {open === c.key && (
                    <div className="border-t border-line px-3 py-2">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-[0.66rem] uppercase tracking-wide text-muted"><th>Date</th><th>Product</th><th className="text-right">Chicks</th><th>Status</th><th className="text-right">Balance</th></tr></thead>
                        <tbody>
                          {c.orders.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((o) => (
                            <tr key={o.id} className="border-t border-line/60">
                              <td className="py-1">{formatDate(o.date)}</td>
                              <td>{o.product}</td>
                              <td className="text-right">{o.chicks.toLocaleString()}</td>
                              <td><Pill tone={o.status === "fulfilled" ? "green" : o.status === "pending" ? "gold" : "neutral"}>{o.status}</Pill></td>
                              <td className="text-right">{formatRWF(balance(o))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </Section>
          )}

          {/* DSRs */}
          {results.dsrs.length > 0 && (
            <Section title={`DSRs (${results.dsrs.length})`}>
              {results.dsrs.map((d) => (
                <Link key={d.id} href={`/dsrs/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 hover:border-gold">
                  <span className="font-semibold text-ink">{d.name} <span className="font-normal text-muted">· {d.phone}</span></span>
                  <span className="text-xs text-muted">{d.district} · {d.zone}{d.active ? "" : " · inactive"}</span>
                </Link>
              ))}
            </Section>
          )}

          {/* Routes */}
          {results.routes.length > 0 && (
            <Section title={`Routes (${results.routes.length})`}>
              {results.routes.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="font-semibold text-ink">{r.name}</span>
                  <span className="text-xs text-muted">Driver: {r.driver}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Orders */}
          {results.orders.length > 0 && (
            <Section title={`Orders (${results.orders.length})`}>
              {results.orders.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="font-medium text-ink">{o.name} <span className="font-normal text-muted">· {o.product} · {formatDate(o.date)}</span></span>
                  <span className="flex items-center gap-2 text-xs text-muted">{o.chicks.toLocaleString()} chicks · {o.district}<Pill tone={o.status === "fulfilled" ? "green" : o.status === "pending" ? "gold" : "neutral"}>{o.status}</Pill></span>
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
