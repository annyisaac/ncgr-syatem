/**
 * Data-access layer — Supabase backend.
 *
 * All persistence goes through this module. It was previously backed by
 * localStorage; it now reads/writes Supabase (Postgres) so data is shared
 * across every computer, while keeping the exact same typed async API — no
 * UI code changed in the swap.
 *
 * Each collection is a keyed table holding the full entity as jsonb:
 *   users(email, data) · dsrs(id, data) · orders(id, data)
 *   commissions(id, data) · statements(id, data)
 *
 * The login session stays in localStorage: it is a per-browser flag, not
 * shared data.
 */

import type {
  AppNotification,
  Availability,
  BankStatement,
  CommissionRequest,
  Database,
  DeliveryLink,
  DSR,
  DsrVisit,
  Order,
  Route,
  User,
} from "./types";
import { SEED_ADMIN } from "./config";
import { getSupabase } from "./supabase";

const SESSION_KEY = "ncgr.session.v1";

// ---------------------------------------------------------------------------
// Generic collection helpers
// ---------------------------------------------------------------------------

const inBrowser = () => typeof window !== "undefined";

async function fetchCollection<T>(table: string): Promise<T[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from(table)
    .select("data")
    .order("updated_at", { ascending: true });
  if (error) {
    // A table this role isn't permitted to read (row-level security) — or a
    // transient error — must not crash the whole app. Degrade to empty so the
    // pages a role DOES use keep working. This is what lets RLS be tightened
    // per-role safely later.
    console.warn(`Could not load ${table}: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => r.data as T);
}

/**
 * Save a list of items (upsert only).
 *
 * DANGER — `prune`: when true this ALSO deletes every row missing from `items`,
 * i.e. it makes the table match the caller's list exactly. A caller whose list
 * is even slightly stale (e.g. another user created a row a second ago) would
 * silently DELETE that row. It has caused real data loss, so `prune` is OFF by
 * default and must only be used where "make the DB match this snapshot" is
 * genuinely intended — currently only `replaceDatabase()` (backup restore).
 *
 * For everything else: upsert-only here, or a single-row upsert/delete below.
 */
async function saveCollection<T>(
  table: string,
  pk: string,
  items: T[],
  keyOf: (item: T) => string,
  prune = false
): Promise<void> {
  if (!inBrowser()) return;
  const sb = getSupabase();
  const now = new Date().toISOString();

  if (items.length > 0) {
    const rows = items.map((item) => ({
      [pk]: keyOf(item),
      data: item,
      updated_at: now,
    }));
    const { error } = await sb.from(table).upsert(rows, { onConflict: pk });
    if (error) throw new Error(`Could not save ${table}: ${error.message}`);
  }

  if (!prune) return;

  // Remove rows that are no longer present (restore only).
  const { data: existing, error: readErr } = await sb.from(table).select(pk);
  if (readErr) throw new Error(`Could not check ${table}: ${readErr.message}`);
  const keep = new Set(items.map(keyOf));
  const remove = ((existing ?? []) as unknown as Record<string, string>[])
    .map((r) => r[pk])
    .filter((k) => !keep.has(k));
  if (remove.length > 0) {
    const { error } = await sb.from(table).delete().in(pk, remove);
    if (error) throw new Error(`Could not clean ${table}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Whole-database access (used by backup / restore and the DataProvider)
// ---------------------------------------------------------------------------

export async function getDatabase(): Promise<Database> {
  const [users, dsrs, orders, commissions, statements, routes, availability, dsrVisits] = await Promise.all([
    fetchCollection<User>("users"),
    fetchCollection<DSR>("dsrs"),
    fetchCollection<Order>("orders"),
    fetchCollection<CommissionRequest>("commissions"),
    fetchCollection<BankStatement>("statements"),
    fetchCollection<Route>("routes"),
    fetchCollection<Availability>("availability"),
    fetchCollection<DsrVisit>("dsr_visits"),
  ]);
  return { users, dsrs, orders, commissions, statements, routes, availability, dsrVisits };
}

/**
 * Replace everything (backup restore) — the ONLY place that prunes rows missing
 * from the passed snapshot. It is destructive by design and is gated behind an
 * explicit Admin confirmation in the UI.
 */
export async function replaceDatabase(db: Database): Promise<void> {
  await Promise.all([
    saveCollection("users", "email", db.users, (u) => u.email, true),
    saveCollection("dsrs", "id", db.dsrs, (d) => d.id, true),
    saveCollection("orders", "id", db.orders, (o) => o.id, true),
    saveCollection("commissions", "id", db.commissions, (c) => c.id, true),
    saveCollection("statements", "id", db.statements, (s) => s.id, true),
    saveCollection("routes", "id", db.routes ?? [], (r) => r.id, true),
    saveCollection("availability", "id", db.availability ?? [], (a) => a.id, true),
    saveCollection("dsr_visits", "id", db.dsrVisits ?? [], (v) => v.id, true),
  ]);
}

/** Ensure the seed admin exists; called once on app start. */
export async function ensureSeed(): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase()
    .from("users")
    .upsert(
      { email: SEED_ADMIN.email, data: SEED_ADMIN },
      { onConflict: "email", ignoreDuplicates: true }
    );
  if (error) throw new Error(`Could not seed admin: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUsers(): Promise<User[]> {
  return fetchCollection<User>("users");
}

export async function saveUsers(users: User[]): Promise<void> {
  return saveCollection("users", "email", users, (u) => u.email);
}

/** Fast single-user upsert (no full-collection scan). */
export async function saveUser(user: User): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase()
    .from("users")
    .upsert(
      { email: user.email, data: user, updated_at: new Date().toISOString() },
      { onConflict: "email" }
    );
  if (error) throw new Error(`Could not save user: ${error.message}`);
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  if (!inBrowser()) return undefined;
  const { data, error } = await getSupabase()
    .from("users")
    .select("data")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new Error(`Could not look up user: ${error.message}`);
  return (data?.data as User) ?? undefined;
}

// ---------------------------------------------------------------------------
// DSRs
// ---------------------------------------------------------------------------

export async function getDSRs(): Promise<DSR[]> {
  return fetchCollection<DSR>("dsrs");
}

export async function saveDSRs(dsrs: DSR[]): Promise<void> {
  return saveCollection("dsrs", "id", dsrs, (d) => d.id);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function getOrders(): Promise<Order[]> {
  return fetchCollection<Order>("orders");
}

export async function saveOrders(orders: Order[]): Promise<void> {
  return saveCollection("orders", "id", orders, (o) => o.id);
}

// ---------------------------------------------------------------------------
// Commission requests
// ---------------------------------------------------------------------------

export async function getCommissions(): Promise<CommissionRequest[]> {
  return fetchCollection<CommissionRequest>("commissions");
}

export async function saveCommissions(
  commissions: CommissionRequest[]
): Promise<void> {
  return saveCollection("commissions", "id", commissions, (c) => c.id);
}

// ---------------------------------------------------------------------------
// Delivery routes
// ---------------------------------------------------------------------------

export async function getRoutes(): Promise<Route[]> {
  return fetchCollection<Route>("routes");
}

export async function saveRoutes(routes: Route[]): Promise<void> {
  return saveCollection("routes", "id", routes, (r) => r.id);
}

// ---------------------------------------------------------------------------
// Ordering availability
// ---------------------------------------------------------------------------

export async function getAvailability(): Promise<Availability[]> {
  return fetchCollection<Availability>("availability");
}

export async function saveAvailability(items: Availability[]): Promise<void> {
  return saveCollection("availability", "id", items, (a) => a.id);
}

// ---------------------------------------------------------------------------
// Bank statements
// ---------------------------------------------------------------------------

export async function getStatements(): Promise<BankStatement[]> {
  return fetchCollection<BankStatement>("statements");
}

export async function saveStatements(
  statements: BankStatement[]
): Promise<void> {
  return saveCollection("statements", "id", statements, (s) => s.id);
}

// ---------------------------------------------------------------------------
// Session (per-browser flag; not shared data)
// ---------------------------------------------------------------------------

export function readSessionEmail(): string | null {
  if (!inBrowser()) return null;
  return window.localStorage.getItem(SESSION_KEY);
}

export function writeSessionEmail(email: string): void {
  if (!inBrowser()) return;
  window.localStorage.setItem(SESSION_KEY, email);
}

export function clearSession(): void {
  if (!inBrowser()) return;
  window.localStorage.removeItem(SESSION_KEY);
}

// ---------------------------------------------------------------------------
// Id helper
// ---------------------------------------------------------------------------

export function newId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Single-row upserts (safe for concurrent multi-user edits)
//
// Unlike saveCollection (which also DELETES rows missing from the passed list),
// these touch exactly one row — so one user saving an order can never wipe out
// another user's concurrently-created data.
// ---------------------------------------------------------------------------

async function upsertOne<T>(table: string, pk: string, key: string, item: T): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase()
    .from(table)
    .upsert({ [pk]: key, data: item, updated_at: new Date().toISOString() }, { onConflict: pk });
  if (error) throw new Error(`Could not save to ${table}: ${error.message}`);
}

async function deleteOne(table: string, pk: string, key: string): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase().from(table).delete().eq(pk, key);
  if (error) throw new Error(`Could not delete from ${table}: ${error.message}`);
}

export const saveOrderOne = (o: Order) => upsertOne("orders", "id", o.id, o);
export const saveStatementOne = (s: BankStatement) => upsertOne("statements", "id", s.id, s);
/** Explicit single-row deletes — the only way the app removes a row. */
export const deleteStatementOne = (id: string) => deleteOne("statements", "id", id);
export const deleteRouteOne = (id: string) => deleteOne("routes", "id", id);
/** Admin-only, irreversible: permanently removes an order. */
export const deleteOrderOne = (id: string) => deleteOne("orders", "id", id);

// ---------------------------------------------------------------------------
// Atomic order placement (availability-checked, race-safe)
//
// Goes through a security-definer Postgres function that locks the day's
// availability row, re-checks the remaining chicks server-side, and inserts —
// so two people can't both place orders that together oversell the day.
// ---------------------------------------------------------------------------

export type PlaceResult =
  | { ok: true }
  | { ok: false; reason: "not_enough" | "date_closed" | "out_of_zone" | "failed"; left?: number; message?: string };

export async function placeOrder(order: Order): Promise<PlaceResult> {
  if (!inBrowser()) return { ok: false, reason: "failed" };
  const { error } = await getSupabase().rpc("place_order", { p_order: order });
  if (!error) return { ok: true };
  const m = error.message || "";
  const nm = m.match(/NOT_ENOUGH:(-?\d+)/);
  if (nm) return { ok: false, reason: "not_enough", left: Math.max(0, Number(nm[1])) };
  if (m.includes("DATE_CLOSED")) return { ok: false, reason: "date_closed" };
  if (m.includes("OUT_OF_ZONE")) return { ok: false, reason: "out_of_zone" };
  return { ok: false, reason: "failed", message: m };
}
export const saveDSROne = (d: DSR) => upsertOne("dsrs", "id", d.id, d);

/** DSR records an (unverified) payment on their own order, via a guarded RPC. */
export async function dsrAddPayment(
  orderId: string,
  amount: number,
  ref: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  if (!inBrowser()) return { ok: false };
  const { data, error } = await getSupabase().rpc("dsr_add_payment", {
    p_order_id: orderId,
    p_amount: amount,
    p_ref: ref,
  });
  if (error) {
    const m = error.message || "";
    if (m.includes("NOT_YOUR_ORDER")) return { ok: false, error: "You can only add payments to your own orders." };
    if (m.includes("BAD_AMOUNT")) return { ok: false, error: "Enter a valid amount." };
    if (m.includes("NO_ORDER")) return { ok: false, error: "That order no longer exists." };
    return { ok: false, error: "Could not record the payment. Please try again." };
  }
  return { ok: true, order: data as Order };
}

/** DSR requests an edit on their own order (reason required); goes to Admin approvals. */
export async function dsrRequestEdit(
  orderId: string,
  reason: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  if (!inBrowser()) return { ok: false };
  const { data, error } = await getSupabase().rpc("dsr_request_edit", {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) {
    const m = error.message || "";
    if (m.includes("NOT_YOUR_ORDER")) return { ok: false, error: "You can only request edits on your own orders." };
    if (m.includes("NO_REASON")) return { ok: false, error: "Enter a reason for the edit." };
    return { ok: false, error: "Could not send the request. Please try again." };
  }
  return { ok: true, order: data as Order };
}

/** DSR logs a farm visit (they own their own rows via RLS). */
export const saveDsrVisitOne = (v: DsrVisit) => upsertOne("dsr_visits", "id", v.id, v);

// ---------------------------------------------------------------------------
// Notifications (in-app). Rows are written server-side by a trigger; the client
// only reads its own (RLS-scoped) and marks them read.
// ---------------------------------------------------------------------------

export async function getNotifications(): Promise<AppNotification[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from("notifications")
    .select("id, data")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) {
    console.warn(`Could not load notifications: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => ({ ...(r.data as AppNotification), id: r.id as string }));
}

/** Mark specific notifications read, or all of the caller's when ids omitted. */
export async function markNotificationsRead(ids?: string[]): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase().rpc("mark_notifications_read", { p_ids: ids ?? null });
  if (error) console.warn(`Could not mark notifications read: ${error.message}`);
}
// ---------------------------------------------------------------------------
// Driver delivery links (public, token-gated)
//
// A salesperson generates one standing link per driver. The driver opens
// /deliver/{token} with no login and marks stops via SECURITY DEFINER RPCs —
// the anon role never reads the tables directly.
// ---------------------------------------------------------------------------

function randomToken(): string {
  const rnd = (globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Math.random()}`).replace(/-/g, "");
  return `dl_${rnd.slice(0, 24)}`;
}

/** Return an existing active link for the driver, or create one. Yields the token. */
export async function ensureDriverLink(driver: string, by: string): Promise<string> {
  if (!inBrowser()) throw new Error("Not in browser");
  const sb = getSupabase();
  const { data: rows, error } = await sb.from("delivery_links").select("id, data");
  if (!error && rows) {
    const found = rows.find((r) => {
      const d = r.data as DeliveryLink;
      return d.active && d.driver === driver;
    });
    if (found) return found.id as string;
  }
  const token = randomToken();
  const link: DeliveryLink = { id: token, token, driver, by, createdAt: new Date().toISOString(), active: true };
  await upsertOne("delivery_links", "id", token, link);
  return token;
}

export interface DriverStop {
  id: string;
  name: string;
  phone: string;
  product: string;
  sector: string;
  district: string;
  date: string;
  plan: number;
  routeName: string;
  pickup: string | null;
  chicks: number;
  failReason: string | null;
}

/** Public: fetch a driver's outstanding stops for a token. */
export async function getDriverManifest(
  token: string
): Promise<{ ok: boolean; driver?: string; stops?: DriverStop[]; error?: string }> {
  if (!inBrowser()) return { ok: false, error: "Not in browser" };
  const { data, error } = await getSupabase().rpc("driver_manifest", { p_token: token });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; driver?: string; stops?: DriverStop[]; error?: string };
}

/** Public: driver marks a stop delivered or (with a reason) not delivered. */
export async function driverDeliver(
  token: string,
  orderId: string,
  delivered: boolean,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  if (!inBrowser()) return { ok: false, error: "Not in browser" };
  const { data, error } = await getSupabase().rpc("driver_deliver", {
    p_token: token,
    p_order_id: orderId,
    p_delivered: delivered,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string };
}

export const saveRouteOne = (r: Route) => upsertOne("routes", "id", r.id, r);
export const saveAvailabilityOne = (a: Availability) => upsertOne("availability", "id", a.id, a);
export const saveCommissionOne = (c: CommissionRequest) => upsertOne("commissions", "id", c.id, c);
