"use client";

/**
 * Shared-tablet operator session. The Hatchery Attendant account is used by
 * several people; each picks their name + enters their code once, and every
 * record they save that session is attributed to them until they switch user.
 * The choice is remembered in localStorage so a reload keeps the same operator.
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
import { useHatchery } from "./HatcheryProvider";
import type { Operator } from "@/lib/hatchery/types";

const KEY = "ncgr-operator-id";

interface OperatorContextValue {
  operator: Operator | null;
  pickOperator: (id: string, code: string) => { ok: boolean; error?: string };
  clearOperator: () => void;
  /** Name to attribute a record to: the session operator, else the fallback. */
  recorder: (fallback: string) => string;
}

const OperatorContext = createContext<OperatorContextValue | null>(null);

export function OperatorProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { operators } = useHatchery();
  const [operatorId, setOperatorId] = useState<string | null>(null);
  // The operator session only applies to the shared attendant tablet account.
  const isAttendant = user?.role === "Hatchery Attendant";

  // Hydrate the remembered operator once on mount.
  useEffect(() => {
    try {
      const id = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (id) setOperatorId(id);
    } catch {
      /* ignore */
    }
  }, []);

  const operator = useMemo(
    () => (isAttendant ? operators.find((o) => o.id === operatorId && o.active) ?? null : null),
    [operators, operatorId, isAttendant]
  );

  const pickOperator = useCallback(
    (id: string, code: string) => {
      const op = operators.find((o) => o.id === id && o.active);
      if (!op) return { ok: false, error: "Select your name." };
      if (code.trim().toUpperCase() !== op.code) return { ok: false, error: "Code does not match your name." };
      setOperatorId(id);
      try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
      return { ok: true };
    },
    [operators]
  );

  const clearOperator = useCallback(() => {
    setOperatorId(null);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);

  const recorder = useCallback((fallback: string) => operator?.name ?? fallback, [operator]);

  const value = useMemo(
    () => ({ operator, pickOperator, clearOperator, recorder }),
    [operator, pickOperator, clearOperator, recorder]
  );

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorContextValue {
  const ctx = useContext(OperatorContext);
  if (!ctx) throw new Error("useOperator must be used within OperatorProvider");
  return ctx;
}
