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
  BankStatement,
  CommissionRequest,
  Database,
  DSR,
  Order,
  User,
} from "@/lib/types";
import {
  deleteStatementOne,
  getDatabase,
  newId,
  replaceDatabase,
  saveCommissions,
  saveDSRs,
  saveOrders,
  saveStatements,
  saveUsers,
} from "@/lib/db";
import { useAuth } from "./AuthProvider";

interface DataContextValue {
  loading: boolean;
  users: User[];
  dsrs: DSR[];
  orders: Order[];
  commissions: CommissionRequest[];
  statements: BankStatement[];

  reload: () => Promise<void>;

  setUsers: (users: User[]) => Promise<void>;
  upsertUser: (user: User) => Promise<void>;

  setDSRs: (dsrs: DSR[]) => Promise<void>;
  upsertDSR: (dsr: DSR) => Promise<void>;

  setOrders: (orders: Order[]) => Promise<void>;
  upsertOrder: (order: Order) => Promise<void>;

  setCommissions: (c: CommissionRequest[]) => Promise<void>;
  upsertCommission: (c: CommissionRequest) => Promise<void>;

  setStatements: (s: BankStatement[]) => Promise<void>;
  /** Delete one statement (saving a filtered list no longer removes rows). */
  removeStatement: (id: string) => Promise<void>;

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
};

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [db, setDb] = useState<Database>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await getDatabase();
      setDb(next);
    } catch (err) {
      console.error("Failed to load data from Supabase:", err);
    }
  }, []);

  // Data is only readable once authenticated — load when a user is present,
  // and clear it on sign-out.
  useEffect(() => {
    let active = true;
    if (!user) {
      setDb(EMPTY);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user, load]);

  // Auth writes (device sign-ins) happen outside this provider — stay in sync.
  useEffect(() => {
    const onUpdate = () => void load();
    window.addEventListener("ncgr:db-updated", onUpdate);
    return () => window.removeEventListener("ncgr:db-updated", onUpdate);
  }, [load]);

  /** Optimistic update: reflect in the UI now, persist in the background. */
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

  const value: DataContextValue = {
    loading,
    users: db.users,
    dsrs: db.dsrs,
    orders: db.orders,
    commissions: db.commissions,
    statements: db.statements,

    reload: load,

    setUsers: (users) => apply("users", users, saveUsers),
    upsertUser: (user) =>
      apply("users", upsert(db.users, user, (u) => u.email === user.email), saveUsers),

    setDSRs: (dsrs) => apply("dsrs", dsrs, saveDSRs),
    upsertDSR: (dsr) =>
      apply("dsrs", upsert(db.dsrs, dsr, (d) => d.id === dsr.id), saveDSRs),

    setOrders: (orders) => apply("orders", orders, saveOrders),
    upsertOrder: (order) =>
      apply("orders", upsert(db.orders, order, (o) => o.id === order.id), saveOrders),

    setCommissions: (commissions) =>
      apply("commissions", commissions, saveCommissions),
    upsertCommission: (c) =>
      apply(
        "commissions",
        upsert(db.commissions, c, (x) => x.id === c.id),
        saveCommissions
      ),

    setStatements: (statements) =>
      apply("statements", statements, saveStatements),
    removeStatement: async (id) => {
      setDb((prev) => ({ ...prev, statements: prev.statements.filter((s) => s.id !== id) }));
      await deleteStatementOne(id);
    },

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
