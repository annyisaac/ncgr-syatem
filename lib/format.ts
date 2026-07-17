/** Date / display helpers (pure). */

/**
 * Is this a valid email address?
 *
 * One shared rule so every "enter an email" form agrees. Requires a single `@`
 * with non-space, non-`@` text on both sides and a dotted domain. Deliberately
 * strict about spaces — a stray space is the most common invalid input, and a
 * looser `/.+@.+\..+/` would accept "a b@c .d".
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}


const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Today's date as yyyy-mm-dd (local). */
export function todayISO(): string {
  const d = new Date();
  return isoDate(d);
}

/** A Date -> yyyy-mm-dd (local, not UTC). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** yyyy-mm-dd or ISO datetime -> "08 Jul 2026". */
export function formatDate(iso: string): string {
  if (!iso) return "—";
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** ISO datetime -> "08 Jul 2026, 14:03". */
export function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(iso)}, ${hh}:${mm}`;
}

export function monthLabel(year: number, monthIndex0: number): string {
  return `${MONTHS_LONG[monthIndex0]} ${year}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Normalize a Rwandan phone number to a comparable key so that
 * "0788598673", "+250788598673", "250788598673" and "788 598 673" all match.
 * Returns the 9-digit local core (e.g. "788598673").
 */
export function normalizePhone(phone: string): string {
  let d = (phone || "").replace(/\D/g, "");
  if (d.startsWith("250")) d = d.slice(3);
  if (d.length === 10 && d.startsWith("0")) d = d.slice(1);
  return d;
}
