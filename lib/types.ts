/**
 * Shared domain types for the NCGR Ltd sales & delivery system.
 *
 * These types are storage-agnostic: the data-access layer (lib/db.ts) is the
 * only place that knows how they are persisted. Keep this file free of any
 * React / browser dependencies so it can be reused on a server later.
 */

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type Product = "Tetra Super Harco" | "Ross 308";

export const PRODUCTS: Product[] = ["Tetra Super Harco", "Ross 308"];

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export type Province =
  | "Kigali City"
  | "Northern"
  | "Southern"
  | "Eastern"
  | "Western";

/** Tetra zones. Kigali City is split by district between the two zones. */
export type Zone = "Zone 1" | "Zone 2";

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------

export type Role =
  // Sales & delivery
  | "Admin"
  | "Tetra Zone Manager"
  | "Tetra Payment Checker"
  | "Ross Order Receiver"
  | "Ross Payment Checker"
  // Hatchery
  | "Hatchery Manager"
  | "Hatchery Operations Manager"
  | "Production Technician"
  | "Hatchery Attendant"
  | "Hatchery Veterinary"
  | "Maintenance Technician"
  | "Hatchery Sales & Coordination Officer"
  | "Operations Manager";

export const ROLES: Role[] = [
  "Admin",
  "Tetra Zone Manager",
  "Tetra Payment Checker",
  "Ross Order Receiver",
  "Ross Payment Checker",
  "Hatchery Manager",
  "Hatchery Operations Manager",
  "Production Technician",
  "Hatchery Attendant",
  "Hatchery Veterinary",
  "Maintenance Technician",
  "Hatchery Sales & Coordination Officer",
  "Operations Manager",
];

/** Roles that belong to the hatchery department. */
export const HATCHERY_ROLES: Role[] = [
  "Hatchery Manager",
  "Hatchery Operations Manager",
  "Production Technician",
  "Hatchery Attendant",
  "Hatchery Veterinary",
  "Maintenance Technician",
  "Hatchery Sales & Coordination Officer",
  "Operations Manager",
];

export function isHatcheryRole(role: Role): boolean {
  return HATCHERY_ROLES.includes(role);
}

/** Hatchery roles allowed to see & allocate sales orders. */
export const HATCHERY_ORDER_ROLES: Role[] = [
  "Hatchery Manager",
  "Hatchery Sales & Coordination Officer",
  "Operations Manager",
];

/** A browser/device this account has signed in from. */
export interface DeviceSession {
  id: string; // stable per-browser id
  label: string; // e.g. "Chrome on Windows"
  firstSeen: string; // ISO datetime
  lastSeen: string; // ISO datetime
  signedIn: boolean;
}

/** A pending password change awaiting Admin approval. */
export interface PasswordRequest {
  newPassword: string;
  on: string; // ISO datetime requested
}

export interface User {
  name: string;
  email: string;
  role: Role;
  /** Required for Tetra Zone Manager; the zone they manage. */
  zone?: Zone;
  password: string;
  active: boolean;
  created: string; // ISO date
  /** Optional profile picture stored as a data URL. */
  avatar?: string;
  /** Pending password change (needs Admin approval). */
  pwRequest?: PasswordRequest;
  /** Devices this account has signed in from. */
  devices?: DeviceSession[];
}

// ---------------------------------------------------------------------------
// DSR (Direct Sales Representative)
// ---------------------------------------------------------------------------

export interface DSR {
  id: string;
  name: string;
  phone: string;
  province: Province;
  district: string;
  sectors: string[]; // one DSR can cover many sectors
  zone: Zone; // derived from district/province
  active: boolean;
  by: string; // email of the user who registered them
}

// ---------------------------------------------------------------------------
// Orders & payments
// ---------------------------------------------------------------------------

export type OrderStatus = "pending" | "fulfilled" | "refunded" | "rejected";

export interface Payment {
  amt: number; // amount recorded
  ref: string; // transaction ID / reference (CASH allowed for manual checks)
  on: string; // ISO datetime recorded
  by: string; // email of who recorded it
  verified: boolean;
  verifiedBy?: string;
  verifiedOn?: string;
  comment?: string; // required for manual verification
  checkedRef?: string; // the reference the checker actually verified
  flag?: string; // e.g. "Amount corrected from statement", "Duplicate ref"
}

export interface Order {
  id: string;
  product: Product;
  province: Province;
  district: string;
  sector: string;
  dsr?: string; // DSR name (denormalized for display)
  dsrId?: string;
  name: string; // client name
  clientDistrict?: string; // the client's own district
  clientSector?: string; // the client's own sector
  phone: string;
  chicks: number; // ordered chicks
  comp: number; // compensated (free) chicks
  price: number; // unit price
  date: string; // delivery date (ISO date)
  status: OrderStatus;
  by: string; // salesperson email
  zone: Zone;
  created: string; // ISO date (delivery-planning day)
  createdAt: string; // ISO datetime of record creation
  history: string[]; // audit log lines, each tagged with actor
  plan: number; // route sort key within a delivery date
  payments: Payment[];
  confirmedOk?: boolean; // order has been confirmed (>=1 payment)
  deliverOk?: boolean; // fulfilled/delivered
  commReq?: boolean; // commission has been requested for this order
  commPaid?: boolean; // commission paid for this order
  request?: OrderRequest; // pending refund/compensation request
}

/**
 * A salesperson-initiated request that needs Admin approval:
 *  - "refund"        — cancel & refund the order
 *  - "compensation"  — add extra free chicks
 *  - "debt"          — deliver the order before it is fully paid
 */
export interface OrderRequest {
  kind: "refund" | "compensation" | "debt";
  reason: string;
  by: string;
  on: string; // ISO datetime
  status: "open" | "approved" | "rejected";
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export type CommissionStatus = "initiated" | "approved" | "rejected";

export interface CommissionRequest {
  id: string;
  dsrId: string;
  dsrName: string;
  district: string;
  product: Product;
  orderIds: string[];
  amount: number;
  chicks: number;
  by: string; // who initiated
  on: string; // ISO datetime initiated
  status: CommissionStatus;
  decidedBy?: string;
  decidedOn?: string;
}

// ---------------------------------------------------------------------------
// Bank statements (for payment verification)
// ---------------------------------------------------------------------------

export interface StatementRow {
  ref: string;
  amt: number;
}

export interface BankStatement {
  id: string;
  fileName: string;
  uploadedBy: string;
  uploadedOn: string; // ISO datetime
  refColumn: string;
  amtColumn: string;
  rows: StatementRow[];
}

// ---------------------------------------------------------------------------
// Full database shape (used for backup / restore)
// ---------------------------------------------------------------------------

export interface Database {
  users: User[];
  dsrs: DSR[];
  orders: Order[];
  commissions: CommissionRequest[];
  statements: BankStatement[];
}

// ---------------------------------------------------------------------------
// Computed helpers (pure functions — no persistence)
// ---------------------------------------------------------------------------

export function extra2(order: Pick<Order, "chicks">): number {
  return Math.round(order.chicks * 0.02);
}

export function toDeliver(order: Pick<Order, "chicks" | "comp">): number {
  return order.chicks + extra2(order) + order.comp;
}

/** Free chicks (2% extra + compensation) are not charged. */
export function orderTotal(order: Pick<Order, "chicks" | "price">): number {
  return order.chicks * order.price;
}

export function paidAmount(order: Pick<Order, "payments">): number {
  return order.payments.reduce((sum, p) => sum + p.amt, 0);
}

export function balance(
  order: Pick<Order, "chicks" | "price" | "payments">
): number {
  return orderTotal(order) - paidAmount(order);
}

export function isFullyPaid(
  order: Pick<Order, "chicks" | "price" | "payments">
): boolean {
  return balance(order) <= 0;
}

export function allVerified(order: Pick<Order, "payments">): boolean {
  return order.payments.length > 0 && order.payments.every((p) => p.verified);
}

/** Number of verified payments over total, e.g. for a "Partially checked" pill. */
export function verifiedCount(order: Pick<Order, "payments">): {
  verified: number;
  total: number;
} {
  return {
    verified: order.payments.filter((p) => p.verified).length,
    total: order.payments.length,
  };
}
