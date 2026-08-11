"use client";

/**
 * In-memory mirror of the database, kept in sync with lib/db (Supabase).
 * All feature pages read from here and mutate through the provided setters,
 * which update the UI immediately (optimistic) and persist the affected
 * collection. No UI component ever talks to Supabase directly.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  AppNotification,
  Availability,
  BankStatement,
  CommissionRequest,
  CustomerFeedback,
  Database,
  DSR,
  DsrVisit,
  Order,
  Role,
  Route,
  User,
} from "@/lib/types";
import {
  fetchCollection,
  getDatabase,
  getPrimaryData,
  getNotifications,
  markNotificationsRead,
  newId,
  replaceDatabase,
  saveAvailability,
  saveAvailabilityOne,
  deleteAvailabilityOne,
  saveCommissions,
  saveCommissionOne,
  saveDsrVisitOne,
  saveCustomerFeedbackOne,
  saveDSRs,
  saveDSROne,
  saveOrders,
  saveOrderOne,
  saveStatementOne,
  deleteStatementOne,
  deleteRouteOne,
  deleteOrderOne,
  placeOrder as placeOrderDb,
  type PlaceResult,
  saveRoutes,
  saveRouteOne,
  saveStatements,
  saveUser,
  saveUsers,
} from "@/lib/db";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

interface DataContextValue {
  loading: boolean;
  users: User[];
  dsrs: DSR[];
  orders: Order[];
  commissions: CommissionRequest[];
  statements: BankStatement[];
  routes: Route[];
  availability: Availability[];

  /** In-app notifications for the signed-in user (live via Realtime). */
  notifications: AppNotification[];
  /** Mark some (or all, when omitted) of my notifications read. */
  markNotifications: (ids?: string[]) => Promise<void>;

  reload: () => Promise<void>;

  setUsers: (users: User[]) => Promise<void>;
  upsertUser: (user: User) => Promise<void>;

  setDSRs: (dsrs: DSR[]) => Promise<void>;
  upsertDSR: (dsr: DSR) => Promise<void>;

  setOrders: (orders: Order[]) => Promise<void>;
  upsertOrder: (order: Order) => Promise<void>;
  /** Admin-only, irreversible: permanently delete one order. */
  removeOrder: (id: string) => Promise<void>;
  /** Race-safe order creation: server re-checks the day's availability. */
  placeOrder: (order: Order) => Promise<PlaceResult>;

  setCommissions: (c: CommissionRequest[]) => Promise<void>;
  upsertCommission: (c: CommissionRequest) => Promise<void>;

  setStatements: (s: BankStatement[]) => Promise<void>;
  upsertStatement: (s: BankStatement) => Promise<void>;
  removeStatement: (id: string) => Promise<void>;
  removeRoute: (id: string) => Promise<void>;

  setRoutes: (r: Route[]) => Promise<void>;
  upsertRoute: (r: Route) => Promise<void>;

  setAvailability: (a: Availability[]) => Promise<void>;
  upsertAvailability: (a: Availability) => Promise<void>;
  removeAvailability: (id: string) => Promise<void>;

  dsrVisits: DsrVisit[];
  upsertDsrVisit: (v: DsrVisit) => Promise<void>;

  customerFeedback: CustomerFeedback[];
  upsertCustomerFeedback: (f: CustomerFeedback) => Promise<void>;

  /** Full replace (backup restore). */
  replaceAll: (db: Database) => Promise<void>;

  newId: (prefix?: string) => string;
}

const DataContext = createContext<DataContextValue | null>(null);

const EMPTY: Database = {
  users: [],
  dsrs: [],
  orders: [],
  commissions: [],
  statements: [],
  routes: [],
  availability: [],
  dsrVisits: [],
  customerFeedback: [],
};

// Realtime table name → the key it maps to in the in-memory mirror. Only these
// tables drive the sales dataset; the map also acts as the allow-list.
const SALES_TABLE_TO_KEY: Record<string, keyof Database> = {
  users: "users",
  dsrs: "dsrs",
  orders: "orders",
  commissions: "commissions",
  statements: "statements",
  routes: "routes",
  availability: "availability",
  dsr_visits: "dsrVisits",
  customer_feedback: "customerFeedback",
};

/** Only these roles have a page that reads bank statements (the verification
 *  page and the checker/admin dashboards), so no other role pays to load that
 *  heavy table — on login or on a realtime change. */
function roleNeedsStatements(role?: Role): boolean {
  return (
    role === "Admin" ||
    role === "Accountant" ||
    role === "Tetra Payment Checker" ||
    role === "Ross Payment Checker"
  );
}

/**
 * Per-device cache of the light dataset (everything except the heavy statements
 * table), so a repeat login on the same device paints the dashboard instantly
 * while fresh data is fetched in the background. Held for the most recent user
 * only, keyed by email, and never shown to a different account.
 */
const DATA_CACHE_KEY = "ncgr.data.v1";
type LightDb = Omit<Database, "statements">;

function readCachedData(email: string): LightDb | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DATA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email: string; data: LightDb };
    if (parsed.email !== email.trim().toLowerCase()) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedData(email: string, db: Database): void {
  if (typeof window === "undefined") return;
  const data: LightDb = {
    users: db.users,
    dsrs: db.dsrs,
    orders: db.orders,
    commissions: db.commissions,
    routes: db.routes ?? [],
    availability: db.availability ?? [],
    dsrVisits: db.dsrVisits ?? [],
    customerFeedback: db.customerFeedback ?? [],
  };
  // Never overwrite a good cache with an empty pre-load snapshot.
  if (Object.values(data).every((arr) => Array.isArray(arr) && arr.length === 0)) return;
  try {
    window.localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ email: email.trim().toLowerCase(), data }));
  } catch {
    // Quota exceeded (very large dataset) — drop any partial entry and skip.
    try { window.localStorage.removeItem(DATA_CACHE_KEY); } catch { /* ignore */ }
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [db, setDb] = useState<Database>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Load the light tables the landing dashboard needs — this is what `loading`
  // waits on, so the app becomes interactive without waiting on statements.
  const loadPrimary = useCallback(async () => {
    try {
      const next = await getPrimaryData();
      setDb((prev) => ({ ...prev, ...next }));
    } catch (err) {
      console.error("Failed to load data from Supabase:", err);
    }
  }, []);

  // The heavy statements table, loaded in the background after the app is
  // interactive (and only for roles whose pages actually read it).
  const loadStatements = useCallback(async () => {
    try {
      const statements = await fetchCollection<BankStatement>("statements");
      setDb((prev) => ({ ...prev, statements }));
    } catch (err) {
      console.error("Failed to load statements:", err);
    }
  }, []);

  // Full reload (backup/restore, explicit refresh) — everything, including statements.
  const load = useCallback(async () => {
    try {
      const next = await getDatabase();
      setDb(next);
    } catch (err) {
      console.error("Failed to load data from Supabase:", err);
    }
  }, []);

  // Refetch a single collection and merge it into the mirror — used by realtime
  // so one row changing somewhere reloads only its own table, not all eight.
  const refetchTable = useCallback(async (table: string) => {
    const key = SALES_TABLE_TO_KEY[table];
    if (!key) return;
    try {
      const rows = await fetchCollection(table);
      setDb((prev) => ({ ...prev, [key]: rows }) as Database);
    } catch (err) {
      console.error(`Failed to refresh ${table}:`, err);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      setNotifications(await getNotifications());
    } catch (err) {
      console.error("Failed to load notifications:", err);
    }
  }, []);

  // Data is only readable once authenticated — load when a user is present,
  // and clear it on sign-out.
  useEffect(() => {
    let active = true;
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDb(EMPTY);
      setNotifications([]);
      setLoading(false);
      return;
    }
    (async () => {
      // Instant: if this device cached this user's data, paint it at once and
      // revalidate in the background instead of waiting on the network.
      const cached = readCachedData(user.email);
      if (cached) {
        setDb((prev) => ({ ...prev, ...cached }));
        if (active) setLoading(false);
      } else {
        setLoading(true);
      }
      await loadPrimary();
      // The app is interactive as soon as the light tables are in.
      if (active) setLoading(false);
      // Stream the heavy statements table in afterwards, only where it's used.
      if (active && roleNeedsStatements(user.role)) void loadStatements();
    })();
    void loadNotifications();
    return () => {
      active = false;
    };
  }, [user, loadPrimary, loadStatements, loadNotifications]);

  // Persist the light dataset to the device (debounced) so the next login on
  // this device paints instantly. Captures both loads and in-session edits.
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => writeCachedData(user.email, db), 500);
    return () => clearTimeout(t);
  }, [user, db]);

  // Live notifications: reload the (RLS-scoped) list whenever a row changes.
  useEffect(() => {
    if (!user) return;
    const channel = getSupabase()
      .channel("notifications-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        void loadNotifications();
      })
      .subscribe();
    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [user, loadNotifications]);

  // Auth writes (device sign-ins) happen outside this provider — stay in sync.
  useEffect(() => {
    // Device sign-ins only touch the users table, so a primary reload suffices
    // (and never drags the heavy statements table along).
    const onUpdate = () => void loadPrimary();
    window.addEventListener("ncgr:db-updated", onUpdate);
    return () => window.removeEventListener("ncgr:db-updated", onUpdate);
  }, [loadPrimary]);

  // Live data: when a sales table changes anywhere, refetch only that table
  // (RLS still scopes what each user receives). A burst of writes is debounced
  // and coalesced, so each affected table reloads once — never the whole set.
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    const flush = () => {
      const tables = [...pending];
      pending.clear();
      for (const t of tables) void refetchTable(t);
    };
    const bump = (table: string) => {
      pending.add(table);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 350);
    };
    const channel = getSupabase()
      .channel("sales-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: { table?: string }) => {
        const table = payload.table ?? "";
        // Skip statements for roles that never load them.
        if (table === "statements" && !roleNeedsStatements(user.role)) return;
        if (SALES_TABLE_TO_KEY[table]) bump(table);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void getSupabase().removeChannel(channel);
    };
  }, [user, refetchTable]);

  /** Optimistic bulk update: reflect in the UI now, persist the whole collection. */
  function apply<K extends keyof Database>(
    key: K,
    list: Database[K],
    save: (list: Database[K]) => Promise<void>
  ): Promise<void> {
    setDb((prev) => ({ ...prev, [key]: list }));
    return save(list).catch((err) => {
      console.error(`Failed to save ${key}:`, err);
      throw err;
    });
  }

  /**
   * Optimistic single-row update. Merges the item into the latest state
   * (functional update, never a stale closure) and persists only that one row,
   * so a concurrent save from another user can never delete it.
   */
  function applyOne<K extends keyof Database, T extends object>(
    key: K,
    item: T,
    matches: (x: T) => boolean,
    saveRow: () => Promise<void>
  ): Promise<void> {
    setDb((prev) => ({ ...prev, [key]: upsert(prev[key] as unknown as T[], item, matches) as unknown as Database[K] }));
    return saveRow().catch((err) => {
      console.error(`Failed to save ${key}:`, err);
      throw err;
    });
  }

  const value: DataContextValue = {
    loading,
    users: db.users,
    dsrs: db.dsrs,
    orders: db.orders,
    commissions: db.commissions,
    statements: db.statements,
    routes: db.routes ?? [],
    availability: db.availability ?? [],
    dsrVisits: db.dsrVisits ?? [],

    notifications,
    markNotifications: async (ids) => {
      // optimistic: flip read locally, then persist
      setNotifications((prev) =>
        prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n))
      );
      await markNotificationsRead(ids);
    },

    reload: load,

    setUsers: (users) => apply("users", users, saveUsers),
    upsertUser: (user) =>
      applyOne("users", user, (u) => u.email === user.email, () => saveUser(user)),

    setDSRs: (dsrs) => apply("dsrs", dsrs, saveDSRs),
    upsertDSR: (dsr) =>
      applyOne("dsrs", dsr, (d) => d.id === dsr.id, () => saveDSROne(dsr)),

    setOrders: (orders) => apply("orders", orders, saveOrders),
    upsertOrder: (order) =>
      applyOne("orders", order, (o) => o.id === order.id, () => saveOrderOne(order)),
    removeOrder: async (id) => {
      setDb((prev) => ({ ...prev, orders: prev.orders.filter((o) => o.id !== id) }));
      await deleteOrderOne(id);
    },
    placeOrder: async (order) => {
      const res = await placeOrderDb(order);
      if (res.ok) {
        setDb((prev) => ({ ...prev, orders: upsert(prev.orders, order, (o) => o.id === order.id) }));
      }
      return res;
    },

    setCommissions: (commissions) =>
      apply("commissions", commissions, saveCommissions),
    upsertCommission: (c) =>
      applyOne("commissions", c, (x) => x.id === c.id, () => saveCommissionOne(c)),

    setStatements: (statements) =>
      apply("statements", statements, saveStatements),
    upsertStatement: (s) =>
      applyOne("statements", s, (x) => x.id === s.id, () => saveStatementOne(s)),
    removeStatement: async (id) => {
      setDb((prev) => ({ ...prev, statements: prev.statements.filter((s) => s.id !== id) }));
      await deleteStatementOne(id);
    },

    setRoutes: (routes) => apply("routes", routes, saveRoutes),
    upsertRoute: (r) =>
      applyOne("routes", r, (x) => x.id === r.id, () => saveRouteOne(r)),
    removeRoute: async (id) => {
      setDb((prev) => ({ ...prev, routes: (prev.routes ?? []).filter((r) => r.id !== id) }));
      await deleteRouteOne(id);
    },

    setAvailability: (a) => apply("availability", a, saveAvailability),
    upsertAvailability: (a) =>
      applyOne("availability", a, (x) => x.id === a.id, () => saveAvailabilityOne(a)),
    removeAvailability: async (id) => {
      setDb((prev) => ({ ...prev, availability: (prev.availability ?? []).filter((a) => a.id !== id) }));
      await deleteAvailabilityOne(id);
    },

    upsertDsrVisit: (v) =>
      applyOne("dsrVisits", v, (x) => x.id === v.id, () => saveDsrVisitOne(v)),

    customerFeedback: db.customerFeedback ?? [],
    upsertCustomerFeedback: (f) =>
      applyOne("customerFeedback", f, (x) => x.id === f.id, () => saveCustomerFeedbackOne(f)),

    replaceAll: async (next) => {
      setDb(next);
      await replaceDatabase(next);
    },

    newId,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function upsert<T>(list: T[], item: T, match: (x: T) => boolean): T[] {
  const idx = list.findIndex(match);
  if (idx === -1) return [...list, item];
  const copy = list.slice();
  copy[idx] = item;
  return copy;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
