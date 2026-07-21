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
  upsertStoreReading: (r: StoreReading) => Promise<void>;
  upsertFumigation: (f: Fumigation) => Promise<void>;
  upsertMachine: (m: Machine) => Promise<void>;
  upsertOperator: (o: Operator) => Promise<void>;
  upsertBatch: (b: Batch) => Promise<void>;
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

function upsertLocal<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

export function HatcheryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = !!user && (isHatcheryRole(user.role) || user.role === "Admin");

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

  const load = useCallback(async () => {
    try {
      const [
        rec, store, fum, mac, op, bat, rd, cnt, box, bt, sup, vac, bio, mnt, inv, alloc, disp, fv, vr, sp, spr, frm, flk, mi, sh,
      ] = await Promise.all([
        fetchTable<Reception>("receptions"),
        fetchTable<StoreReading>("store_readings"),
        fetchTable<Fumigation>("fumigations"),
        fetchTable<Machine>("machines"),
        fetchTable<Operator>("operators"),
        fetchTable<Batch>("batches"),
        fetchTable<MachineReading>("machine_readings"),
        fetchTable<ChickCount>("chick_counts"),
        fetchTable<BoxLog>("box_logs"),
        fetchTable<BoxTarget>("box_targets"),
        fetchTable<Supply>("supplies"),
        fetchTable<Vaccination>("vaccinations"),
        fetchTable<LogEntry>("biosecurity_logs"),
        fetchTable<LogEntry>("maintenance_logs"),
        fetchTable<ChickInventory>("chick_inventory"),
        fetchTable<Allocation>("allocations"),
        fetchTable<Dispatch>("dispatches"),
        fetchTable<FarmVisit>("farm_visits"),
        fetchTable<VaccineRequest>("vaccine_requests"),
        fetchTable<SparePart>("spare_parts"),
        fetchTable<SparePartRequest>("spare_part_requests"),
        fetchTable<Farm>("farms"),
        fetchTable<Flock>("flocks"),
        fetchTable<MachineIssue>("machine_issues"),
        fetchTable<ShiftHandover>("shift_handovers"),
      ]);
      setReceptions(rec);
      setStoreReadings(store);
      setFumigations(fum);
      setMachines(mac);
      setOperators(op);
      setBatches(bat);
      setReadings(rd);
      setCounts(cnt);
      setBoxLogs(box);
      setBoxTargets(bt);
      setSupplies(sup);
      setVaccinations(vac);
      setBiosecurity(bio);
      setMaintenance(mnt);
      setInventory(inv);
      setAllocations(alloc);
      setDispatches(disp);
      setFarmVisits(fv);
      setVaccineRequests(vr);
      setSpareParts(sp);
      setSpareRequests(spr);
      setFarms(frm);
      setFlocks(flk);
      setMachineIssues(mi);
      setShiftHandovers(sh);
    } catch (err) {
      console.error("Failed to load hatchery data:", err);
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [enabled, load]);

  // Live data: refetch the hatchery dataset whenever any of its tables changes
  // anywhere. Debounced so a burst of writes triggers a single reload — no
  // manual refresh needed. (chick_inventory keeps its own realtime through
  // this same path.)
  useEffect(() => {
    if (!enabled) return;
    const HATCHERY_TABLES = new Set([
      "receptions", "store_readings", "fumigations", "machines", "operators", "batches",
      "machine_readings", "chick_counts", "box_logs", "box_targets", "supplies", "vaccinations",
      "biosecurity_logs", "maintenance_logs", "chick_inventory", "allocations", "dispatches",
      "farm_visits", "vaccine_requests", "spare_parts", "spare_part_requests", "farms", "flocks",
      "machine_issues", "shift_handovers",
    ]);
    const sb = getSupabase();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 350);
    };
    const channel = sb
      .channel("hatchery-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: { table?: string }) => {
        if (HATCHERY_TABLES.has(payload.table ?? "")) bump();
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      sb.removeChannel(channel);
    };
  }, [enabled, load]);

  function persist<T extends { id: string }>(
    table: HatcheryTable,
    row: T,
    setter: (updater: (prev: T[]) => T[]) => void
  ): Promise<void> {
    setter((prev) => upsertLocal(prev, row));
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
    upsertStoreReading: (r) => persist("store_readings", r, setStoreReadings),
    upsertFumigation: (f) => persist("fumigations", f, setFumigations),
    upsertMachine: (m) => persist("machines", m, setMachines),
    upsertOperator: (o) => persist("operators", o, setOperators),
    upsertBatch: (b) => persist("batches", b, setBatches),
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
