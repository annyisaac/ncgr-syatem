/**
 * Excel helpers. `xlsx` (SheetJS) is a browser library, so it is imported
 * dynamically on the client only (avoids SSR issues).
 */

import type { StatementRow } from "./types";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
}

/** Read the first sheet of an Excel/CSV file into headers + row objects. */
export async function parseWorkbook(file: File): Promise<ParsedSheet> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: false,
  });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

const REF_HINTS = [
  "ref",
  "reference",
  "transaction",
  "txn",
  "trans",
  "detail",
  "narration",
  "description",
];
const AMT_HINTS = ["amount", "amt", "credit", "value", "paid", "deposit"];
const DATE_HINTS = ["value date", "posting date", "transaction date", "trans date", "date", "posted", "time"];

function guess(headers: string[], hints: string[]): string {
  const lower = headers.map((h) => ({ h, l: h.toLowerCase() }));
  for (const hint of hints) {
    const found = lower.find((x) => x.l.includes(hint));
    if (found) return found.h;
  }
  return headers[0] ?? "";
}

export function guessRefColumn(headers: string[]): string {
  return guess(headers, REF_HINTS);
}

export function guessAmountColumn(headers: string[]): string {
  return guess(headers, AMT_HINTS);
}

/** Best guess for a date column — or "" if none looks like a date (date is optional). */
export function guessDateColumn(headers: string[]): string {
  const lower = headers.map((h) => ({ h, l: h.toLowerCase() }));
  for (const hint of DATE_HINTS) {
    const found = lower.find((x) => x.l.includes(hint));
    if (found) return found.h;
  }
  return "";
}

const PHONE_HINTS = ["phone", "msisdn", "sender", "payer", "mobile", "number", "from", "counterparty", "account"];

/** Best guess for a payer/sender phone column — or "" if none looks like one (optional). */
export function guessPhoneColumn(headers: string[]): string {
  const lower = headers.map((h) => ({ h, l: h.toLowerCase() }));
  for (const hint of PHONE_HINTS) {
    const found = lower.find((x) => x.l.includes(hint));
    if (found) return found.h;
  }
  return "";
}

/** Parse a numeric amount that may contain commas / currency text. */
export function parseAmount(value: unknown): number {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Build normalized {ref, amt, date?} rows from a parsed sheet using chosen columns. */
export function buildStatementRows(
  sheet: ParsedSheet,
  refColumn: string,
  amtColumn: string,
  dateColumn?: string,
  phoneColumn?: string
): StatementRow[] {
  return sheet.rows
    .map((r) => {
      const row: StatementRow = {
        ref: String(r[refColumn] ?? "").trim(),
        amt: parseAmount(r[amtColumn]),
      };
      if (dateColumn) {
        const d = String(r[dateColumn] ?? "").trim();
        if (d) row.date = d;
      }
      if (phoneColumn) {
        const p = String(r[phoneColumn] ?? "").trim();
        if (p) row.phone = p;
      }
      return row;
    })
    .filter((r) => r.ref !== "");
}
