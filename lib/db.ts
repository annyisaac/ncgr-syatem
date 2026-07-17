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
  BankStatement,
  CommissionRequest,
  Database,
  DSR,
  Order,
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
    // per-role safely.
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
  const [users, dsrs, orders, commissions, statements] = await Promise.all([
    fetchCollection<User>("users"),
    fetchCollection<DSR>("dsrs"),
    fetchCollection<Order>("orders"),
    fetchCollection<CommissionRequest>("commissions"),
    fetchCollection<BankStatement>("statements"),
  ]);
  return { users, dsrs, orders, commissions, statements };
}

/**
 * Replace everything (backup restore).
 *
 * The only place `prune` is legitimate: restoring a backup genuinely means
 * "make the database match this snapshot", so rows absent from the backup are
 * meant to go. Every other caller upserts and never deletes by omission.
 */
export async function replaceDatabase(db: Database): Promise<void> {
  await Promise.all([
    saveUsers(db.users, true),
    saveDSRs(db.dsrs, true),
    saveOrders(db.orders, true),
    saveCommissions(db.commissions, true),
    saveStatements(db.statements, true),
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

export async function saveUsers(users: User[], prune = false): Promise<void> {
  return saveCollection("users", "email", users, (u) => u.email, prune);
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

export async function saveDSRs(dsrs: DSR[], prune = false): Promise<void> {
  return saveCollection("dsrs", "id", dsrs, (d) => d.id, prune);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function getOrders(): Promise<Order[]> {
  return fetchCollection<Order>("orders");
}

export async function saveOrders(orders: Order[], prune = false): Promise<void> {
  return saveCollection("orders", "id", orders, (o) => o.id, prune);
}

// ---------------------------------------------------------------------------
// Commission requests
// ---------------------------------------------------------------------------

export async function getCommissions(): Promise<CommissionRequest[]> {
  return fetchCollection<CommissionRequest>("commissions");
}

export async function saveCommissions(
  commissions: CommissionRequest[],
  prune = false
): Promise<void> {
  return saveCollection("commissions", "id", commissions, (c) => c.id, prune);
}

// ---------------------------------------------------------------------------
// Bank statements
// ---------------------------------------------------------------------------

export async function getStatements(): Promise<BankStatement[]> {
  return fetchCollection<BankStatement>("statements");
}

export async function saveStatements(
  statements: BankStatement[],
  prune = false
): Promise<void> {
  return saveCollection("statements", "id", statements, (s) => s.id, prune);
}

/**
 * Delete one bank statement.
 *
 * Removing a statement used to work by passing a filtered list to
 * saveStatements() and letting the prune step notice the gap. That is the
 * delete-by-omission pattern that cost us an order, so deletion is now
 * explicit and targets exactly one row.
 */
export async function deleteStatementOne(id: string): Promise<void> {
  if (!inBrowser()) return;
  const { error } = await getSupabase().from("statements").delete().eq("id", id);
  if (error) throw new Error(`Could not delete statement: ${error.message}`);
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
