/**
 * Client records derived from orders, keyed by normalized phone number.
 * A client is primarily the sum of their orders, so records rebuild from the
 * orders collection and stay automatically in sync. A standalone `Client` row
 * (the optional clients table) is merged on top by matching key, so staff can
 * hold a client who hasn't ordered yet or correct contact details — without
 * ever creating a duplicate. Financials always come from the orders; contact
 * info prefers the standalone record when present.
 */

import { normalizePhone } from "./format";
import { balance, paidAmount, toDeliver, type Client, type Order, type Payment, type Product, type Zone } from "./types";

export interface ClientRecord {
  id: string; // url-safe key (normalized phone, else name slug)
  name: string;
  phone: string;
  orders: Order[];
  ordersCount: number;
  chicks: number; // total chicks ordered
  toDeliver: number; // total chicks to deliver (incl. free + comp)
  paid: number; // total paid across all orders
  balance: number; // net outstanding — positive = owing, negative = credit (prepaid)
  districts: string[];
  sectors: string[];
  lastOrder: string; // most recent delivery date
  /** Has at least one live (non-closed) order, or a standalone record marked active. */
  active: boolean;
  /** The backing clients-table row, when this client has one (drives edit/delete). */
  record?: Client;
  /** Visibility scope carried from the backing record (for cross-product roles). */
  product?: Product;
  zone?: Zone;
}

/** The url-safe client key for an order (normalized phone, else a name slug). */
export function clientKey(o: Order): string {
  const p = normalizePhone(o.phone);
  return p || `name:${o.name.trim().toLowerCase()}`;
}
const keyOf = clientKey;

/** The same key computed from a standalone client record's current fields. */
export function clientRecordKey(c: { phone?: string; name: string }): string {
  const p = normalizePhone(c.phone ?? "");
  return p || `name:${c.name.trim().toLowerCase()}`;
}

const isClosed = (o: Order) => o.status === "refunded" || o.status === "rejected";

export function buildClients(orders: Order[], clients: Client[] = []): ClientRecord[] {
  const map = new Map<string, ClientRecord>();
  const blank = (id: string, name: string, phone: string): ClientRecord => ({
    id, name, phone, orders: [], ordersCount: 0,
    chicks: 0, toDeliver: 0, paid: 0, balance: 0, districts: [], sectors: [], lastOrder: "",
    active: false,
  });

  for (const o of orders) {
    const id = keyOf(o);
    if (!id) continue;
    const c = map.get(id) ?? blank(id, o.name, o.phone);
    c.orders.push(o);
    c.ordersCount += 1;
    c.name = o.name; // keep latest spelling
    if (o.phone) c.phone = o.phone;
    if (!isClosed(o)) {
      c.chicks += o.chicks;
      c.toDeliver += toDeliver(o);
      c.balance += balance(o); // net: a prepaid order (negative) reduces what's owed
      c.active = true; // a live order makes the client active
    }
    c.paid += paidAmount(o);
    if (o.district && !c.districts.includes(o.district)) c.districts.push(o.district);
    const sec = o.clientSector || o.sector;
    if (sec && !c.sectors.includes(sec)) c.sectors.push(sec);
    if (o.date > c.lastOrder) c.lastOrder = o.date;
    map.set(id, c);
  }

  // Overlay standalone client records: attach to the matching derived client, or
  // add a record-only client (zero financials) when there's no order for them.
  for (const rec of clients) {
    const id = clientRecordKey(rec);
    if (!id) continue;
    const c = map.get(id) ?? blank(id, rec.name, rec.phone);
    c.record = rec;
    if (rec.name.trim()) c.name = rec.name; // edited master name wins
    if (rec.phone?.trim()) c.phone = rec.phone;
    if (rec.district && !c.districts.includes(rec.district)) c.districts.unshift(rec.district);
    if (rec.sector && !c.sectors.includes(rec.sector)) c.sectors.unshift(rec.sector);
    c.product = rec.product;
    c.zone = rec.zone;
    // Active if a live order exists OR the record is flagged active (default true).
    c.active = c.active || (rec.active ?? true);
    map.set(id, c);
  }

  return [...map.values()].sort((a, b) => (a.lastOrder < b.lastOrder ? 1 : -1));
}

export function clientById(orders: Order[], id: string, clients: Client[] = []): ClientRecord | undefined {
  return buildClients(orders, clients).find((c) => c.id === id);
}

/** Find the registry record for a customer (by phone, else name slug). */
export function findClient(clients: Client[], phone: string, name: string): Client | undefined {
  const key = clientRecordKey({ phone, name });
  return clients.find((c) => c.id === key || clientRecordKey(c) === key);
}

/** Credit already paid back to this customer — subtracted from their credit. */
export function creditRefundedFor(clients: Client[], phone: string, name: string): number {
  const c = findClient(clients, phone, name);
  return (c?.creditRefunds ?? []).reduce((s, r) => s + (r.amt || 0), 0);
}

/** The next friendly customer code, e.g. "C-000123", from the existing records. */
export function nextClientCode(clients: Client[]): string {
  let max = 0;
  for (const c of clients) {
    const m = /^C-(\d+)$/.exec(c.code ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `C-${String(max + 1).padStart(6, "0")}`;
}

/** All payments across a client's orders, newest first, tagged with the order.
 *  Applied customer credit is shown as a verified "Customer credit" line so it
 *  reads as paid (it's already-verified money). */
export function clientPayments(client: ClientRecord): Array<Payment & { orderName: string; product: string }> {
  return client.orders
    .flatMap((o) => {
      const rows: Array<Payment & { orderName: string; product: string }> = o.payments.map((p) => ({
        ...p, orderName: o.name, product: o.product,
      }));
      if ((o.creditApplied ?? 0) > 0) {
        rows.push({
          amt: o.creditApplied as number,
          ref: "Customer credit",
          on: o.createdAt,
          by: "",
          verified: true,
          fromCredit: true,
          orderName: o.name,
          product: o.product,
        });
      }
      return rows;
    })
    .sort((a, b) => (a.on < b.on ? 1 : -1));
}
