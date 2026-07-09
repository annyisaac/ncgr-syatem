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
  ChickInventory,
  Dispatch,
  LogEntry,
  MachineReading,
  Vaccination,
} from "@/lib/hatchery/types";

interface HatcheryContextValue {
  loading: boolean;
  batches: Batch[];
  readings: MachineReading[];
  vaccinations: Vaccination[];
  biosecurity: LogEntry[];
  maintenance: LogEntry[];
  inventory: ChickInventory[];
  allocations: Allocation[];
  dispatches: Dispatch[];

  reload: () => Promise<void>;

  upsertBatch: (b: Batch) => Promise<void>;
  upsertReading: (r: MachineReading) => Promise<void>;
  upsertVaccination: (v: Vaccination) => Promise<void>;
  upsertBiosecurity: (l: LogEntry) => Promise<void>;
  upsertMaintenance: (l: LogEntry) => Promise<void>;
  upsertInventory: (i: ChickInventory) => Promise<void>;
  removeInventory: (id: string) => Promise<void>;
  upsertAllocation: (a: Allocation) => Promise<void>;
  upsertDispatch: (d: Dispatch) => Promise<void>;

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
  const [batches, setBatches] = useState<Batch[]>([]);
  const [readings, setReadings] = useState<MachineReading[]>([]);
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [biosecurity, setBiosecurity] = useState<LogEntry[]>([]);
  const [maintenance, setMaintenance] = useState<LogEntry[]>([]);
  const [inventory, setInventory] = useState<ChickInventory[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);

  const load = useCallback(async () => {
    try {
      const [b, r, v, bio, mnt, inv, alloc, disp] = await Promise.all([
        fetchTable<Batch>("batches"),
        fetchTable<MachineReading>("machine_readings"),
        fetchTable<Vaccination>("vaccinations"),
        fetchTable<LogEntry>("biosecurity_logs"),
        fetchTable<LogEntry>("maintenance_logs"),
        fetchTable<ChickInventory>("chick_inventory"),
        fetchTable<Allocation>("allocations"),
        fetchTable<Dispatch>("dispatches"),
      ]);
      setBatches(b);
      setReadings(r);
      setVaccinations(v);
      setBiosecurity(bio);
      setMaintenance(mnt);
      setInventory(inv);
      setAllocations(alloc);
      setDispatches(disp);
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

  // Live inventory (sales portal + other hatchery users see changes instantly).
  useEffect(() => {
    if (!enabled) return;
    const sb = getSupabase();
    const channel = sb
      .channel("chick_inventory_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chick_inventory" },
        () => {
          fetchTable<ChickInventory>("chick_inventory")
            .then(setInventory)
            .catch(() => {});
        }
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [enabled]);

  async function persist<T extends { id: string }>(
    table: HatcheryTable,
    row: T,
    setter: (updater: (prev: T[]) => T[]) => void
  ) {
    setter((prev) => upsertLocal(prev, row));
    await upsertRow(table, row).catch((e) => {
      console.error(`save ${table} failed`, e);
      throw e;
    });
  }

  const value: HatcheryContextValue = {
    loading,
    batches,
    readings,
    vaccinations,
    biosecurity,
    maintenance,
    inventory,
    allocations,
    dispatches,
    reload: load,
    upsertBatch: (b) => persist("batches", b, setBatches),
    upsertReading: (r) => persist("machine_readings", r, setReadings),
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
    newId,
  };

  return (
    <HatcheryContext.Provider value={value}>
      {children}
    </HatcheryContext.Provider>
  );
}

export function useHatchery(): HatcheryContextValue {
  const ctx = useContext(HatcheryContext);
  if (!ctx) throw new Error("useHatchery must be used within HatcheryProvider");
  return ctx;
}
