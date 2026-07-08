"use client";

/**
 * In-memory mirror of the database, kept in sync with lib/db (localStorage
 * today). All feature pages read from here and mutate through the provided
 * setters, which persist atomically. This keeps every screen consistent and
 * means no UI component ever touches storage directly.
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
import { getDatabase, replaceDatabase, ensureSeed, newId } from "@/lib/db";

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
  const [db, setDb] = useState<Database>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    await ensureSeed();
    const next = await getDatabase();
    setDb(next);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  // Auth writes (device sign-ins) happen outside this provider — stay in sync.
  useEffect(() => {
    const onUpdate = () => void load();
    window.addEventListener("ncgr:db-updated", onUpdate);
    return () => window.removeEventListener("ncgr:db-updated", onUpdate);
  }, [load]);

  const persist = useCallback(async (next: Database) => {
    setDb(next);
    await replaceDatabase(next);
  }, []);

  const value: DataContextValue = {
    loading,
    users: db.users,
    dsrs: db.dsrs,
    orders: db.orders,
    commissions: db.commissions,
    statements: db.statements,

    reload: load,

    setUsers: (users) => persist({ ...db, users }),
    upsertUser: (user) =>
      persist({
        ...db,
        users: upsert(db.users, user, (u) => u.email === user.email),
      }),

    setDSRs: (dsrs) => persist({ ...db, dsrs }),
    upsertDSR: (dsr) =>
      persist({ ...db, dsrs: upsert(db.dsrs, dsr, (d) => d.id === dsr.id) }),

    setOrders: (orders) => persist({ ...db, orders }),
    upsertOrder: (order) =>
      persist({
        ...db,
        orders: upsert(db.orders, order, (o) => o.id === order.id),
      }),

    setCommissions: (commissions) => persist({ ...db, commissions }),
    upsertCommission: (c) =>
      persist({
        ...db,
        commissions: upsert(db.commissions, c, (x) => x.id === c.id),
      }),

    setStatements: (statements) => persist({ ...db, statements }),

    replaceAll: (next) => persist(next),

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
