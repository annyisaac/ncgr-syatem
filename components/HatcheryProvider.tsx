"use client";

/**
 * In-memory mirror of the hatchery tables, loaded only for hatchery/admin
 * roles. Optimistic mutators persist to Supabase; chick_inventory is kept
 * live via Supabase Realtime.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { isHatcheryRole } from "@/lib/types";
import { getSupabase } from "@/lib/supabase";
import {
  deleteRow,
  fetchTable,
  newId,
  upsertRow,
  type HatcheryTable,
} from "@/lib/hatchery/db";
import type {
  Allocation,
  Batch,
  BoxLog,
  BoxTarget,
  ChickCount,
  ChickInventory,
  Dispatch,
  FarmVisit,
  Fumigation,
  LogEntry,
  Machine,
  MachineIssue,
  MachineReading,
  Operator,
  Farm,
  Flock,
  Reception,
  ShiftHandover,
  SparePart,
  SparePartRequest,
  StoreReading,
  Supply,
  Vaccination,
  VaccineRequest,
} from "@/lib/hatchery/types";

interface HatcheryContextValue {
  loading: boolean;
  receptions: Reception[];
  storeReadings: StoreReading[];
  fumigations: Fumigation[];
  machines: Machine[];
  operators: Operator[];
  batches: Batch[];
  readings: MachineReading[];
  counts: ChickCount[];
  boxLogs: BoxLog[];
  boxTargets: BoxTarget[];
  supplies: Supply[];
  vaccinations: Vaccination[];
  biosecurity: LogEntry[];
  maintenance: LogEntry[];
  inventory: ChickInventory[];
  allocations: Allocation[];
  dispatches: Dispatch[];
  farmVisits: FarmVisit[];
  vaccineRequests: VaccineRequest[];
  spareParts: SparePart[];
  spareRequests: SparePartRequest[];
  farms: Farm[];
  flocks: Flock[];
  machineIssues: MachineIssue[];
  shiftHandovers: ShiftHandover[];

  reload: () => Promise<void>;

  upsertReception: (r: Reception) => Promise<void>;
  removeReception: (id: string) => Promise<void>;
  upsertStoreReading: (r: StoreReading) => Promise<void>;
  upsertFumigation: (f: Fumigation) => Promise<void>;
  upsertMachine: (m: Machine) => Promise<void>;
  upsertOperator: (o: Operator) => Promise<void>;
  upsertBatch: (b: Batch) => Promise<void>;
  removeBatch: (id: string) => Promise<void>;
  /** Reflect a batch change in the UI/cache without a DB write — used after an
   *  authorized RPC (e.g. set_batch_no) has already persisted it. */
  patchBatchLocal: (b: Batch) => void;
  upsertReading: (r: MachineReading) => Promise<void>;
  upsertCount: (c: ChickCount) => Promise<void>;
  upsertBoxLog: (l: BoxLog) => Promise<void>;
  upsertBoxTarget: (t: BoxTarget) => Promise<void>;
  upsertSupply: (s: Supply) => Promise<void>;
  upsertVaccination: (v: Vaccination) => Promise<void>;
  upsertBiosecurity: (l: LogEntry) => Promise<void>;
  upsertMaintenance: (l: LogEntry) => Promise<void>;
  upsertInventory: (i: ChickInventory) => Promise<void>;
  removeInventory: (id: string) => Promise<void>;
  upsertAllocation: (a: Allocation) => Promise<void>;
  upsertDispatch: (d: Dispatch) => Promise<void>;
  upsertFarmVisit: (v: FarmVisit) => Promise<void>;
  upsertVaccineRequest: (r: VaccineRequest) => Promise<void>;
  upsertSparePart: (p: SparePart) => Promise<void>;
  upsertSpareRequest: (r: SparePartRequest) => Promise<void>;
  upsertFarm: (f: Farm) => Promise<void>;
  upsertFlock: (f: Flock) => Promise<void>;
  upsertMachineIssue: (i: MachineIssue) => Promise<void>;
  upsertShiftHandover: (h: ShiftHandover) => Promise<void>;

  newId: (prefix: string) => string;
}

const HatcheryContext = createContext<HatcheryContextValue | null>(null);

// The tables this provider mirrors — also the realtime allow-list.
const ALL_TABLES: HatcheryTable[] = [
  "receptions", "store_readings", "fumigations", "machines", "operators", "batches",
  "machine_readings", "chick_counts", "box_logs", "box_targets", "supplies", "vaccinations",
  "biosecurity_logs", "maintenance_logs", "chick_inventory", "allocations", "dispatches",
  "farm_visits", "vaccine_requests", "spare_parts", "spare_part_requests", "farms", "flocks",
  "machine_issues", "shift_handovers",
];
const HATCHERY_TABLES = new Set<string>(ALL_TABLES);

// Instant-paint cache of the last session's hatchery data (per browser). The
// high-volume append-only tables are skipped — they can be large and aren't
// needed for the first paint; they stream in on the background refresh.
const CACHE_KEY = "ncgr:hatchery:v1";
const NO_CACHE = new Set(["machine_readings", "biosecurity_logs", "maintenance_logs", "chick_counts", "box_logs"]);

function upsertLocal<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

// Keep the local instant-paint cache in step with an optimistic write, so the
// next login paints the edited row (not the pre-edit one) before the fresh
// load arrives. Cached tables only (NO_CACHE tables are never persisted).
function patchCache<T extends { id: string }>(table: string, row: T): void {
  if (typeof window === "undefined" || NO_CACHE.has(table)) return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const cache = raw ? (JSON.parse(raw) as Record<string, unknown[]>) : {};
    const list = Array.isArray(cache[table]) ? (cache[table] as T[]) : [];
    cache[table] = upsertLocal(list, row);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota / private mode — the background load will still refresh it */
  }
}

export function HatcheryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  // Hatchery roles live in this module, so load eagerly on login. Admin and
  // Accountant only visit hatchery data on hatchery/costing pages (and Admin on
  // Availability, which projects delivery dates from batches) — so for them we
  // defer the 25-table load until they open one, keeping their login (dashboard,
  // orders, …) from firing dozens of unused requests.
  const needsHatchery =
    pathname.startsWith("/hatchery") ||
    pathname.startsWith("/costing") ||
    pathname.startsWith("/availability");
  const enabled =
    !!user &&
    (isHatcheryRole(user.role) ||
      ((user.role === "Admin" || user.role === "Accountant") && needsHatchery));

  const [loading, setLoading] = useState(true);
  const [receptions, setReceptions] = useState<Reception[]>([]);
  const [storeReadings, setStoreReadings] = useState<StoreReading[]>([]);
  const [fumigations, setFumigations] = useState<Fumigation[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [readings, setReadings] = useState<MachineReading[]>([]);
  const [counts, setCounts] = useState<ChickCount[]>([]);
  const [boxLogs, setBoxLogs] = useState<BoxLog[]>([]);
  const [boxTargets, setBoxTargets] = useState<BoxTarget[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [biosecurity, setBiosecurity] = useState<LogEntry[]>([]);
  const [maintenance, setMaintenance] = useState<LogEntry[]>([]);
  const [inventory, setInventory] = useState<ChickInventory[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [farmVisits, setFarmVisits] = useState<FarmVisit[]>([]);
  const [vaccineRequests, setVaccineRequests] = useState<VaccineRequest[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [spareRequests, setSpareRequests] = useState<SparePartRequest[]>([]);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [flocks, setFlocks] = useState<Flock[]>([]);
  const [machineIssues, setMachineIssues] = useState<MachineIssue[]>([]);
  const [shiftHandovers, setShiftHandovers] = useState<ShiftHandover[]>([]);

  // Route a table's rows to the right slice of state. Shared by the initial
  // load, the realtime refetch and the instant-cache hydrate.
  const applyTable = useCallback((table: string, rows: unknown[]) => {
    switch (table) {
      case "receptions": setReceptions(rows as Reception[]); return;
      case "store_readings": setStoreReadings(rows as StoreReading[]); return;
      case "fumigations": setFumigations(rows as Fumigation[]); return;
      case "machines": setMachines(rows as Machine[]); return;
      case "operators": setOperators(rows as Operator[]); return;
      case "batches": setBatches(rows as Batch[]); return;
      case "machine_readings": setReadings(rows as MachineReading[]); return;
      case "chick_counts": setCounts(rows as ChickCount[]); return;
      case "box_logs": setBoxLogs(rows as BoxLog[]); return;
      case "box_targets": setBoxTargets(rows as BoxTarget[]); return;
      case "supplies": setSupplies(rows as Supply[]); return;
      case "vaccinations": setVaccinations(rows as Vaccination[]); return;
      case "biosecurity_logs": setBiosecurity(rows as LogEntry[]); return;
      case "maintenance_logs": setMaintenance(rows as LogEntry[]); return;
      case "chick_inventory": setInventory(rows as ChickInventory[]); return;
      case "allocations": setAllocations(rows as Allocation[]); return;
      case "dispatches": setDispatches(rows as Dispatch[]); return;
      case "farm_visits": setFarmVisits(rows as FarmVisit[]); return;
      case "vaccine_requests": setVaccineRequests(rows as VaccineRequest[]); return;
      case "spare_parts": setSpareParts(rows as SparePart[]); return;
      case "spare_part_requests": setSpareRequests(rows as SparePartRequest[]); return;
      case "farms": setFarms(rows as Farm[]); return;
      case "flocks": setFlocks(rows as Flock[]); return;
      case "machine_issues": setMachineIssues(rows as MachineIssue[]); return;
      case "shift_handovers": setShiftHandovers(rows as ShiftHandover[]); return;
    }
  }, []);

  // Progressive load: every table sets its own slice as soon as it arrives, so
  // the UI fills in table-by-table instead of blocking on the slowest one.
  // Small tables are cached for an instant paint on the next login.
  const load = useCallback(async () => {
    const cache: Record<string, unknown[]> = {};
    await Promise.all(ALL_TABLES.map(async (t) => {
      try {
        const rows = await fetchTable(t);
        applyTable(t, rows);
        if (!NO_CACHE.has(t)) cache[t] = rows;
      } catch (err) {
        console.error(`Failed to load ${t}:`, err);
      }
    }));
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* quota / private mode */ }
  }, [applyTable]);

  const refetchTable = useCallback(async (table: string) => {
    try { applyTable(table, await fetchTable(table as HatcheryTable)); }
    catch (err) { console.error(`Failed to refresh ${table}:`, err); }
  }, [applyTable]);

  // Paint the last session's data from the local cache — returns true if it did.
  const hydrate = useCallback(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const cached = JSON.parse(raw) as Record<string, unknown[]>;
      let any = false;
      for (const t of Object.keys(cached)) {
        if (Array.isArray(cached[t])) { applyTable(t, cached[t]); any = true; }
      }
      return any;
    } catch { return false; }
  }, [applyTable]);

  useEffect(() => {
    let active = true;
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    // Instant: show last-known data immediately, only block when there's none.
    const hadCache = hydrate();
    setLoading(!hadCache);
    (async () => {
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [enabled, load, hydrate]);

  // Live data: when a hatchery table changes anywhere, refetch only that table.
  // A burst of writes is debounced and coalesced, so each affected table
  // reloads once — never all 25. (chick_inventory keeps its own realtime
  // through this same path.)
  useEffect(() => {
    if (!enabled) return;
    const sb = getSupabase();
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
    const channel = sb
      .channel("hatchery-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: { table?: string }) => {
        if (HATCHERY_TABLES.has(payload.table ?? "")) bump(payload.table!);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      sb.removeChannel(channel);
    };
  }, [enabled, refetchTable]);

  function persist<T extends { id: string }>(
    table: HatcheryTable,
    row: T,
    setter: (updater: (prev: T[]) => T[]) => void
  ): Promise<void> {
    setter((prev) => upsertLocal(prev, row));
    patchCache(table, row);
    return upsertRow(table, row).catch((e) => {
      console.error(`save ${table} failed`, e);
      throw e;
    });
  }

  // Expose batches newest-first everywhere (by creation, descending).
  const sortedBatches = useMemo(
    () => batches.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [batches]
  );

  const value: HatcheryContextValue = {
    loading,
    receptions, storeReadings, fumigations, machines, operators, batches: sortedBatches, readings,
    counts, boxLogs, boxTargets, supplies, vaccinations, biosecurity, maintenance,
    inventory, allocations, dispatches, farmVisits, vaccineRequests,
    spareParts, spareRequests, farms, flocks, machineIssues, shiftHandovers,
    reload: load,
    upsertReception: (r) => persist("receptions", r, setReceptions),
    removeReception: async (id) => {
      setReceptions((prev) => prev.filter((x) => x.id !== id));
      await deleteRow("receptions", id);
    },
    upsertStoreReading: (r) => persist("store_readings", r, setStoreReadings),
    upsertFumigation: (f) => persist("fumigations", f, setFumigations),
    upsertMachine: (m) => persist("machines", m, setMachines),
    upsertOperator: (o) => persist("operators", o, setOperators),
    upsertBatch: (b) => persist("batches", b, setBatches),
    removeBatch: async (id) => {
      setBatches((prev) => prev.filter((x) => x.id !== id));
      await deleteRow("batches", id);
    },
    patchBatchLocal: (b) => { setBatches((prev) => upsertLocal(prev, b)); patchCache("batches", b); },
    upsertReading: (r) => persist("machine_readings", r, setReadings),
    upsertCount: (c) => persist("chick_counts", c, setCounts),
    upsertBoxLog: (l) => persist("box_logs", l, setBoxLogs),
    upsertBoxTarget: (t) => persist("box_targets", t, setBoxTargets),
    upsertSupply: (s) => persist("supplies", s, setSupplies),
    upsertVaccination: (v) => persist("vaccinations", v, setVaccinations),
    upsertBiosecurity: (l) => persist("biosecurity_logs", l, setBiosecurity),
    upsertMaintenance: (l) => persist("maintenance_logs", l, setMaintenance),
    upsertInventory: (i) => persist("chick_inventory", i, setInventory),
    removeInventory: async (id) => {
      setInventory((prev) => prev.filter((x) => x.id !== id));
      await deleteRow("chick_inventory", id);
    },
    upsertAllocation: (a) => persist("allocations", a, setAllocations),
    upsertDispatch: (d) => persist("dispatches", d, setDispatches),
    upsertFarmVisit: (v) => persist("farm_visits", v, setFarmVisits),
    upsertVaccineRequest: (r) => persist("vaccine_requests", r, setVaccineRequests),
    upsertSparePart: (p) => persist("spare_parts", p, setSpareParts),
    upsertSpareRequest: (r) => persist("spare_part_requests", r, setSpareRequests),
    upsertFarm: (f) => persist("farms", f, setFarms),
    upsertFlock: (f) => persist("flocks", f, setFlocks),
    upsertMachineIssue: (i) => persist("machine_issues", i, setMachineIssues),
    upsertShiftHandover: (h) => persist("shift_handovers", h, setShiftHandovers),
    newId,
  };

  return <HatcheryContext.Provider value={value}>{children}</HatcheryContext.Provider>;
}

export function useHatchery(): HatcheryContextValue {
  const ctx = useContext(HatcheryContext);
  if (!ctx) throw new Error("useHatchery must be used within HatcheryProvider");
  return ctx;
}
