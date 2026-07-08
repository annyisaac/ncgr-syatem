/**
 * Data-access layer.
 *
 * All persistence goes through this module. Today it is backed by the browser's
 * localStorage, but every function is async and typed so the backend can be
 * swapped for Firebase / Postgres / an API without touching any UI code.
 *
 * UI code must NEVER read localStorage directly — it calls these functions.
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

// ---------------------------------------------------------------------------
// Storage keys & low-level access
// ---------------------------------------------------------------------------

const KEY = "ncgr.db.v1";
const SESSION_KEY = "ncgr.session.v1";

function emptyDb(): Database {
  return {
    users: [SEED_ADMIN],
    dsrs: [],
    orders: [],
    commissions: [],
    statements: [],
  };
}

/**
 * The storage backend. Swapping this object (or its implementation) is the
 * single point of change when moving off localStorage.
 */
interface StorageBackend {
  read(): Database;
  write(db: Database): void;
  readRaw(key: string): string | null;
  writeRaw(key: string, value: string): void;
  removeRaw(key: string): void;
}

const localStorageBackend: StorageBackend = {
  read() {
    if (typeof window === "undefined") return emptyDb();
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      const seeded = emptyDb();
      window.localStorage.setItem(KEY, JSON.stringify(seeded));
      return seeded;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<Database>;
      // Merge with an empty db so missing collections never crash the UI.
      return { ...emptyDb(), ...parsed } as Database;
    } catch {
      return emptyDb();
    }
  },
  write(db) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEY, JSON.stringify(db));
  },
  readRaw(key) {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  },
  writeRaw(key, value) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  },
  removeRaw(key) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  },
};

const backend: StorageBackend = localStorageBackend;

// Simulate async so the interface already matches a real remote backend.
function ok<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

// ---------------------------------------------------------------------------
// Whole-database access (used by backup / restore)
// ---------------------------------------------------------------------------

export async function getDatabase(): Promise<Database> {
  return ok(backend.read());
}

export async function replaceDatabase(db: Database): Promise<void> {
  backend.write(db);
  return ok(undefined);
}

/** Ensure the seed admin exists; called once on app start. */
export async function ensureSeed(): Promise<void> {
  const db = backend.read();
  if (!db.users.some((u) => u.email === SEED_ADMIN.email)) {
    db.users.push(SEED_ADMIN);
    backend.write(db);
  }
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUsers(): Promise<User[]> {
  return ok(backend.read().users);
}

export async function saveUsers(users: User[]): Promise<void> {
  const db = backend.read();
  db.users = users;
  backend.write(db);
  return ok(undefined);
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const users = backend.read().users;
  return ok(users.find((u) => u.email.toLowerCase() === email.toLowerCase()));
}

// ---------------------------------------------------------------------------
// DSRs
// ---------------------------------------------------------------------------

export async function getDSRs(): Promise<DSR[]> {
  return ok(backend.read().dsrs);
}

export async function saveDSRs(dsrs: DSR[]): Promise<void> {
  const db = backend.read();
  db.dsrs = dsrs;
  backend.write(db);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function getOrders(): Promise<Order[]> {
  return ok(backend.read().orders);
}

export async function saveOrders(orders: Order[]): Promise<void> {
  const db = backend.read();
  db.orders = orders;
  backend.write(db);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Commission requests
// ---------------------------------------------------------------------------

export async function getCommissions(): Promise<CommissionRequest[]> {
  return ok(backend.read().commissions);
}

export async function saveCommissions(
  commissions: CommissionRequest[]
): Promise<void> {
  const db = backend.read();
  db.commissions = commissions;
  backend.write(db);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Bank statements
// ---------------------------------------------------------------------------

export async function getStatements(): Promise<BankStatement[]> {
  return ok(backend.read().statements);
}

export async function saveStatements(
  statements: BankStatement[]
): Promise<void> {
  const db = backend.read();
  db.statements = statements;
  backend.write(db);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Session (kept separate from the main db; a flag-based persisted session)
// ---------------------------------------------------------------------------

export function readSessionEmail(): string | null {
  return backend.readRaw(SESSION_KEY);
}

export function writeSessionEmail(email: string): void {
  backend.writeRaw(SESSION_KEY, email);
}

export function clearSession(): void {
  backend.removeRaw(SESSION_KEY);
}

// ---------------------------------------------------------------------------
// Id helper
// ---------------------------------------------------------------------------

export function newId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
