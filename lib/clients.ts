/**
 * Client records derived from orders, keyed by normalized phone number.
 * There is no separate "clients" table — a client is the sum of their orders,
 * so records rebuild from the orders collection and stay automatically in sync.
 */

import { normalizePhone } from "./format";
import { balance, paidAmount, toDeliver, type Order, type Payment } from "./types";

export interface ClientRecord {
  id: string; // url-safe key (normalized phone, else name slug)
  name: string;
  phone: string;
  orders: Order[];
  ordersCount: number;
  chicks: number; // total chicks ordered
  toDeliver: number; // total chicks to deliver (incl. free + comp)
  paid: number; // total paid across all orders
  balance: number; // total outstanding
  districts: string[];
  sectors: string[];
  lastOrder: string; // most recent delivery date
}

/** The url-safe client key for an order (normalized phone, else a name slug). */
export function clientKey(o: Order): string {
  const p = normalizePhone(o.phone);
  return p || `name:${o.name.trim().toLowerCase()}`;
}
const keyOf = clientKey;

const isClosed = (o: Order) => o.status === "refunded" || o.status === "rejected";

export function buildClients(orders: Order[]): ClientRecord[] {
  const map = new Map<string, ClientRecord>();
  for (const o of orders) {
    const id = keyOf(o);
    if (!id) continue;
    const c = map.get(id) ?? {
      id, name: o.name, phone: o.phone, orders: [], ordersCount: 0,
      chicks: 0, toDeliver: 0, paid: 0, balance: 0, districts: [], sectors: [], lastOrder: "",
    };
    c.orders.push(o);
    c.ordersCount += 1;
    c.name = o.name; // keep latest spelling
    if (o.phone) c.phone = o.phone;
    if (!isClosed(o)) {
      c.chicks += o.chicks;
      c.toDeliver += toDeliver(o);
      c.balance += Math.max(0, balance(o));
    }
    c.paid += paidAmount(o);
    if (o.district && !c.districts.includes(o.district)) c.districts.push(o.district);
    const sec = o.clientSector || o.sector;
    if (sec && !c.sectors.includes(sec)) c.sectors.push(sec);
    if (o.date > c.lastOrder) c.lastOrder = o.date;
    map.set(id, c);
  }
  return [...map.values()].sort((a, b) => (a.lastOrder < b.lastOrder ? 1 : -1));
}

export function clientById(orders: Order[], id: string): ClientRecord | undefined {
  return buildClients(orders).find((c) => c.id === id);
}

/** All payments across a client's orders, newest first, tagged with the order. */
export function clientPayments(client: ClientRecord): Array<Payment & { orderName: string; product: string }> {
  return client.orders
    .flatMap((o) => o.payments.map((p) => ({ ...p, orderName: o.name, product: o.product })))
    .sort((a, b) => (a.on < b.on ? 1 : -1));
}
