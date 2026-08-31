"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { formatMoney } from "@/lib/config";
import { formatDate, todayISO } from "@/lib/format";
import { balance, paidAmount, toDeliver, isFullyPaid, allVerified, type Order, type Currency } from "@/lib/types";
import { orderStage } from "@/lib/orders";

type Filter = "all" | "owing" | "upcoming" | "delivered";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "owing", label: "Owing" },
  { value: "upcoming", label: "Upcoming" },
  { value: "delivered", label: "Delivered" },
];

/** Payment pill, shared by the desktop row and the phone card. */
function payState(o: Order) {
  if (isFullyPaid(o)) return { label: allVerified(o) ? "Paid ✓" : "Paid", tone: "green" as const };
  if (o.debtOk) return { label: "On debt", tone: "info" as const };
  if (paidAmount(o) > 0) return { label: "Partial", tone: "gold" as const };
  return { label: "Unpaid", tone: "red" as const };
}

export default function DsrOrdersPage() {
  const { user } = useAuth();
  const { dsrs, orders } = useData();
  const search = useSearchParams();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);
  // Every order in the DSR's zone (RLS already scopes the data to their zone).
  const zoneOrders = useMemo(
    () => (myDsr ? orders.filter((o) => o.zone === myDsr.zone).sort((a, b) => (a.date < b.date ? 1 : -1)) : []),
    [orders, myDsr]
  );

  const [q, setQ] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  // The home page's "My orders owing" tile links here with ?f=owing.
  const [filter, setFilter] = useState<Filter>(search.get("f") === "owing" ? "owing" : "all");

  const shown = useMemo(() => {
    const today = todayISO();
    let rows = zoneOrders;
    if (mineOnly && myDsr) rows = rows.filter((o) => o.dsrId === myDsr.id);
    if (filter === "owing") rows = rows.filter((o) => balance(o) > 0 && !o.debtOk && o.status !== "rejected" && o.status !== "refunded");
    else if (filter === "upcoming") rows = rows.filter((o) => o.date >= today && o.status === "pending");
    else if (filter === "delivered") rows = rows.filter((o) => o.deliverOk || o.status === "fulfilled");
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    const digits = s.replace(/\D/g, "");
    return rows.filter((o) =>
      o.name.toLowerCase().includes(s) ||
      (digits !== "" && o.phone.replace(/\D/g, "").includes(digits)) ||
      (o.dsr ?? "").toLowerCase().includes(s)
    );
  }, [zoneOrders, q, mineOnly, filter, myDsr]);

  // Totals for what's on screen. Balances stay split per currency — the app
  // never converts between RWF/USD/EUR.
  const totals = useMemo(() => {
    const chicks = shown.reduce((s, o) => s + toDeliver(o), 0);
    const owed = new Map<Currency, number>();
    for (const o of shown) {
      const b = balance(o);
      if (b <= 0) continue;
      const cur = o.currency ?? "RWF";
      owed.set(cur, (owed.get(cur) ?? 0) + b);
    }
    return { chicks, owed: Array.from(owed.entries()) };
  }, [shown]);

  if (!user) return null;
  if (!myDsr) return <Card><p className="text-sm text-muted">Your DSR profile could not be found.</p></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/dsr/order" className="rounded-[10px] bg-gold px-4 py-2.5 text-[0.82rem] font-bold text-[#231b04] transition hover:brightness-[1.05]">
          + New order
        </Link>
      </div>
      <Card>
        <CardHeader title={`${shown.length} order(s) ${mineOnly ? "of yours" : "in your zone"}`} />
        <div className="mb-3 sticky top-16 z-20 -mx-5 space-y-2.5 border-b border-line bg-paper/95 px-5 py-3 backdrop-blur">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by client name or phone…"
            className="w-full rounded-[9px] border border-line bg-field px-3.5 py-2.5 text-[0.9rem] text-ink focus:outline-none focus-visible:border-gold"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`rounded-full border px-3 py-1 text-[0.75rem] font-semibold transition ${
                  filter === f.value ? "border-gold bg-gold-bg text-gold-dark" : "border-line text-muted hover:border-gold"
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-line" />
            <button
              type="button"
              onClick={() => setMineOnly((v) => !v)}
              className={`rounded-full border px-3 py-1 text-[0.75rem] font-semibold transition ${
                mineOnly ? "border-gold bg-gold-bg text-gold-dark" : "border-line text-muted hover:border-gold"
              }`}
            >
              Only mine
            </button>
          </div>
        </div>

        {/* What is on screen, at a glance: chicks to deliver and money still owed. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted">To deliver: <strong className="tabular-nums text-ink">{totals.chicks.toLocaleString()}</strong> chicks</span>
          <span className="text-muted">
            Outstanding:{" "}
            {totals.owed.length === 0 ? (
              <strong className="text-green">nothing</strong>
            ) : (
              totals.owed.map(([cur, amt], i) => (
                <strong key={cur} className="tabular-nums text-red">{i > 0 ? " · " : ""}{formatMoney(amt, cur)}</strong>
              ))
            )}
          </span>
        </div>

        <div className="hidden sm:block">
          <TableWrap>
            <thead>
              <tr>
                <Th>Delivery date</Th><Th>Client</Th><Th>DSR</Th><Th>Product</Th>
                <Th className="text-right">Chicks</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Payment</Th><Th>Status</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? <EmptyRow colSpan={10} text="No matching orders." /> : shown.map((o) => {
                const t = orderStage(o);
                const pay = payState(o);
                return (
                  <tr key={o.id} className="cursor-pointer hover:bg-gold-bg">
                    <Td>{formatDate(o.date)}</Td>
                    <Td className="font-medium">
                      <Link href={`/dsr/orders/${o.id}`} className="text-gold-dark underline underline-offset-2">{o.name}</Link>
                      {" "}<span className="text-xs text-muted">· {o.phone}</span>
                    </Td>
                    <Td className="text-muted">{o.dsr ?? "—"}</Td>
                    <Td>{o.product}</Td>
                    <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                    <Td className="text-right">{formatMoney(paidAmount(o), o.currency)}</Td>
                    <Td className={`text-right ${balance(o) > 0 ? "font-semibold text-red" : ""}`}>{formatMoney(balance(o), o.currency)}</Td>
                    <Td><Pill tone={pay.tone}>{pay.label}</Pill></Td>
                    <Td><Pill tone={t.tone}>{t.label}</Pill></Td>
                    <Td>
                      <Link href={`/dsr/orders/${o.id}`} className="inline-block rounded-md border border-line px-2.5 py-1 text-[0.72rem] font-semibold text-ink transition hover:border-gold hover:bg-gold-bg">
                        Manage
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </div>

        {/* Phones: one tap-through card per order — DSRs work from the field. */}
        <div className="space-y-2.5 sm:hidden">
          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No matching orders.</p>
          ) : shown.map((o) => {
            const t = orderStage(o);
            const pay = payState(o);
            const bal = balance(o);
            return (
              <Link key={o.id} href={`/dsr/orders/${o.id}`} className="block rounded-2xl border border-line bg-paper p-3.5 shadow-card transition active:border-gold">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gold-dark">{o.name}</p>
                    <p className="text-xs text-ink/50">{o.phone}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Pill tone={pay.tone}>{pay.label}</Pill>
                    <Pill tone={t.tone}>{t.label}</Pill>
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Delivery</p>
                    <p className="font-medium text-ink">{formatDate(o.date)}</p>
                    <p className="text-xs text-ink/50">{o.product}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">To deliver</p>
                    <p className="font-medium tabular-nums text-ink">{toDeliver(o).toLocaleString()}</p>
                    <p className="truncate text-xs text-ink/50">{o.dsr ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Paid</p>
                    <p className="font-medium tabular-nums text-ink">{formatMoney(paidAmount(o), o.currency)}</p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Balance</p>
                    <p className={`font-medium tabular-nums ${bal > 0 ? "text-red" : "text-green"}`}>{formatMoney(bal, o.currency)}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
