/**
 * Per-agent, per-delivery-date chick quotas for the Ross Sales Agent — the
 * "number of chicks to sell on a certain delivery date". Same jsonb-per-row
 * convention as the rest of the app. RLS: an agent reads only their own rows;
 * an Admin reads/writes all.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";

export interface AgentQuota {
  id: string; // `${agentEmail}|${date}`
  agentEmail: string;
  date: string; // yyyy-mm-dd delivery date
  chicks: number; // chicks this agent may sell on that date
  by: string;
  on: string;
}

export function quotaId(agentEmail: string, date: string): string {
  return `${agentEmail.trim().toLowerCase()}|${date}`;
}

export async function listAgentQuotas(): Promise<AgentQuota[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("agent_quotas").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load quotas: ${error.message}`);
  return (data ?? []).map((r) => r.data as AgentQuota);
}

export async function upsertAgentQuota(q: AgentQuota): Promise<void> {
  const { error } = await getSupabase().from("agent_quotas").upsert({ id: q.id, data: q, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save quota: ${error.message}`);
}

/** A field agent records a payment on their own order (via a scoped RPC — they
 *  have no UPDATE access to orders otherwise). */
export async function agentAddPayment(orderId: string, payment: unknown): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc("agent_add_payment", { p_order_id: orderId, p_payment: payment });
  if (error) {
    const m = error.message || "";
    if (m.includes("DUPLICATE_PAYMENT_REF")) return { ok: false, error: "That transaction reference is already recorded on another order." };
    if (m.includes("FORBIDDEN")) return { ok: false, error: "You can only add payments to orders you created." };
    if (m.includes("BAD_PAYMENT")) return { ok: false, error: "Enter a valid amount." };
    return { ok: false, error: "Could not save the payment — please try again." };
  }
  return { ok: true };
}

/** The chicks an agent may still sell on a date: allocation − what they've
 *  already sold there (active orders they created). Returns null when no quota
 *  has been assigned for that date (i.e. they can't sell that day). */
export function remainingQuota(
  quotas: AgentQuota[],
  agentEmail: string,
  date: string,
  soldByThisAgentOnDate: number
): number | null {
  const q = quotas.find((x) => x.id === quotaId(agentEmail, date));
  if (!q) return null;
  return Math.max(0, q.chicks - soldByThisAgentOnDate);
}
