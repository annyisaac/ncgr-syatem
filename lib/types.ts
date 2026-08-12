/**
 * Shared domain types for the NCGR LTD sales & delivery system.
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
  | "DSR"
  // Finance
  | "Accountant"
  // Logistics
  | "Logistics Officer"
  // Parent stock (breeder farm)
  | "Parent Stock Manager"
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
  "DSR",
  "Accountant",
  "Logistics Officer",
  "Parent Stock Manager",
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

/** An in-app notification (also mirrored to email in Tier 2). */
/** Every action on an order notifies whoever "has" it (see `_order_audience`). */
export type NotificationType =
  | "new_order"
  | "payment"
  | "reschedule"
  | "rejected"
  | "confirmed"
  | "fulfilled"
  | "refunded"
  | "deleted"
  | "allocated"
  | "delivery_failed";
export interface AppNotification {
  id: string;
  recipient: string;
  type: NotificationType;
  title: string;
  body: string;
  orderId?: string;
  read: boolean;
  createdAt: string;
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
  monthlyTarget?: number; // chicks/month target set by the zone manager
  // DSR login (code, locked to one device)
  loginCode?: string; // system-generated sign-in code
  deviceId?: string; // the single device the code is bound to
  deviceLabel?: string; // human label of that device
  authEmail?: string; // derived Supabase auth email backing the code login
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
  /** How the money came in. Bank payments also carry a bank name and a slip. */
  method?: "MoMo" | "Bank";
  bankName?: string;
  /** Object path of an uploaded bank slip in the private "payment-slips" bucket. */
  slipPath?: string;
  verified: boolean;
  verifiedBy?: string;
  verifiedOn?: string;
  comment?: string; // required for manual verification
  checkedRef?: string; // the reference the checker actually verified
  flag?: string; // e.g. "Amount corrected from statement", "Duplicate ref"
  /**
   * A checker tried to verify but one or more transaction ids were not in any
   * bank statement — the payment is held for the Admin's final decision.
   */
  pendingApproval?: { by: string; on: string; refs: string[]; note?: string };
  /**
   * The checker couldn't find this transaction id in any uploaded statement and
   * returned it to the seller / zone manager to review and correct the id. While
   * set, the payment is back in the seller's court; clearing it (after a fix)
   * puts it back in the checker's queue.
   */
  returnedForFix?: { by: string; on: string; refs: string[]; note?: string };
  /**
   * Admin sent this payment back as a reused-reference dispute. While set, any
   * correction by the seller / zone manager / payment checker must come back to
   * the Admin to verify & approve (it can't be finalized by anyone else). Cleared
   * when the Admin approves.
   */
  reusedDispute?: boolean;
  /** The seller has corrected the reference at least once. If it is STILL not in
   *  a statement after that, the checker escalates to the Admin rather than
   *  bouncing it back to the seller again. */
  refFixed?: boolean;
  /** Admin rejected this payment (not in any statement). A voided payment is
   *  kept for the record but no longer counts toward Paid/Balance or delivery. */
  voided?: boolean;
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
  /** The hatchery has finalized an allocation of chicks to this order (reserved). */
  allocatedOk?: boolean;
  deliverOk?: boolean; // fulfilled/delivered
  deliveredAt?: string; // ISO datetime delivered — drives the 24h driver-link window
  /** Approved to be delivered on debt — may be allocated without verified payment. */
  debtOk?: boolean;
  /** Set when a driver marks the stop NOT delivered (order stays open for sales). */
  deliveryFail?: { reason: string; on: string; by: string };
  /** True when the driver captured proof of delivery (GPS/signature/photo) — the
   *  actual proof lives in the delivery_proofs table, not on the order. */
  hasProof?: boolean;
  commReq?: boolean; // commission has been requested for this order
  commPaid?: boolean; // commission paid for this order
  request?: OrderRequest; // pending refund/compensation request
  // Delivery planning
  routeId?: string; // assigned delivery route
  deliveryChicks?: number; // chicks allocated for delivery
  pickupLocation?: string; // where the chicks are picked up
  /** Paid chicks actually handed over. When set and < chicks, the order was a
   *  short delivery and is billed on this number, not the ordered amount. */
  delivered?: number;
  /** This order continues an earlier one that could only be part-delivered. */
  backorderOf?: string;
  /** This order is a same-day split-off from a larger order (id of the original),
   *  so it can be delivered on a different truck/route. */
  splitOf?: string;
  /** Customer credit (RWF) drawn onto this order from their wallet — counts
   *  toward the balance so a credit-funded order can be confirmed/delivered. */
  creditApplied?: number;
}

/**
 * A standing, unguessable public link a salesperson generates for a driver.
 * The driver opens /deliver/{token} (no login) to mark their stops delivered.
 * `id` is the token itself.
 */
export interface DeliveryLink {
  id: string; // the token (== URL segment)
  token: string; // same value, kept for readability
  driver: string; // route driver name this link belongs to
  /** The specific route this link is for. Newer links are per-route (one date's
   *  stops); older links without it fall back to all of the driver's stops. */
  routeId?: string;
  by: string; // salesperson who created it
  createdAt: string; // ISO datetime
  active: boolean;
  /** Once shared from the system, the link can't be copied / QR'd again. */
  shared?: boolean;
  sharedBy?: string;
  sharedAt?: string;
}

// ---------------------------------------------------------------------------
// Delivery routes (delivery planning)
// ---------------------------------------------------------------------------

export interface Route {
  id: string;
  name: string;
  driver: string;
  vehicle?: string; // vehicle plate / label assigned to this route
  capacity?: number; // max chicks the driver/vehicle can carry (for overload warnings)
  /** Delivery date this route belongs to. Absent on older routes, which stay
   *  visible on every day for backward compatibility. */
  date?: string;
  /** Driver's confirmation, at pickup, of the chick load they're taking out
   *  (signed on the delivery link). The signature itself lives in delivery_proofs. */
  pickupConfirmed?: { by: string; at: string; chicks: number };
  by: string; // salesperson who created it
  on: string; // ISO datetime
}

// ---------------------------------------------------------------------------
// Ordering availability (Admin opens delivery dates with a per-product cap)
// ---------------------------------------------------------------------------

export interface Availability {
  id: string; // the date, yyyy-mm-dd
  date: string;
  ross: number; // chicks available for Ross 308 that day
  tetra: number; // chicks available for Tetra Super Harco that day
  fromBatch?: boolean; // auto-published from hatchery batch projections (set date + 21 days)
  closed?: boolean; // date is paused — no longer selectable when placing orders
  by: string;
  on: string;
}

/** Chicks a product can still take on a given date (available − already ordered). */
export function availableFor(
  avail: Availability | undefined,
  product: Product,
  orders: Pick<Order, "date" | "product" | "chicks" | "status">[]
): number {
  if (!avail) return 0;
  const cap = product === "Ross 308" ? avail.ross : avail.tetra;
  const used = orders
    .filter((o) => o.date === avail.date && o.product === product && o.status !== "refunded" && o.status !== "rejected")
    .reduce((s, o) => s + o.chicks, 0);
  return Math.max(0, cap - used);
}

/**
 * A salesperson-initiated request that needs Admin approval:
 *  - "refund"        — cancel & refund the order
 *  - "compensation"  — add extra free chicks
 *  - "debt"          — deliver the order before it is fully paid
 */
export interface OrderRequest {
  kind: "refund" | "compensation" | "debt" | "edit" | "reschedule";
  reason: string;
  by: string;
  on: string; // ISO datetime
  status: "open" | "approved" | "rejected";
  date?: string; // requested new delivery date (reschedule requests)
}

// ---------------------------------------------------------------------------
// DSR farm visits (a DSR logs a visit to a customer's farm)
// ---------------------------------------------------------------------------

export interface DsrVisit {
  id: string;
  dsrId: string;
  by: string; // DSR login email
  farm: string; // customer / farm name
  phone?: string;
  date: string; // ISO date of the visit
  purpose: string;
  notes: string;
  createdAt: string; // ISO datetime
}

// ---------------------------------------------------------------------------
// Customer feedback (post-delivery follow-up calls)
//
// A payment checker calls each delivered customer and records what they said.
// If the customer needs veterinary attention it is flagged for the hatchery
// vet, who follows up and updates the record until it is resolved.
// ---------------------------------------------------------------------------

export type FeedbackRating = "satisfied" | "neutral" | "unsatisfied";
export type VetFollowUpStatus = "pending" | "in_progress" | "resolved";

/** One vet follow-up note on an escalated feedback record. */
export interface VetUpdate {
  note: string;
  by: string; // vet email
  byName?: string;
  on: string; // ISO datetime
  status: VetFollowUpStatus;
}

/**
 * One feedback record per delivered order, keyed by the order id. It carries a
 * denormalized snapshot of the customer + delivery so the vet can follow up
 * without any access to the sales `orders` table.
 */
export interface CustomerFeedback {
  id: string; // == the delivered order's id (one feedback per delivery)
  orderId: string;
  // Denormalized customer / delivery snapshot
  customerName: string;
  phone: string;
  product: Product;
  deliveryDate: string; // ISO date
  chicks: number;
  district?: string;
  sector?: string;
  dsr?: string;
  // Feedback recorded by the payment checker
  note: string;
  rating?: FeedbackRating;
  by: string; // recorder email
  byName?: string;
  on: string; // ISO datetime last recorded/updated
  // Vet escalation & follow-up
  needsVet: boolean;
  vetReason?: string;
  vetStatus?: VetFollowUpStatus; // set when needsVet is true
  vetName?: string; // the vet handling the case (set when a vet first acts)
  vetAssignedTo?: string; // email of the vet this case is assigned to (chosen when needs-vet is flagged)
  vetAssignedName?: string; // that vet's display name, for showing without a users lookup
  vetUpdates?: VetUpdate[];
  history: string[]; // audit log lines
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
// Client (customer) master record
// ---------------------------------------------------------------------------

/**
 * A standalone customer record. Clients are still primarily DERIVED from orders
 * (see lib/clients.ts), but this optional table lets staff add or correct a
 * client's contact details independently of any order, and hold a client who
 * hasn't ordered yet. A record is merged onto the order-derived client by
 * matching key (normalized phone, else name slug), so it never creates a
 * duplicate — financials always come from the orders, contact info from here.
 */
export interface Client {
  id: string; // client key: normalized phone, else `name:<slug>` (see clientRecordKey)
  name: string;
  phone: string;
  district?: string;
  sector?: string;
  /** Visibility scope. Undefined = both products (Admin/Accountant-created). */
  product?: Product;
  /** Zone, for zone-scoped roles (Tetra Zone Manager). */
  zone?: Zone;
  note?: string;
  /** Manual active flag — used for the Active/Inactive tabs when the client has
   *  no live orders. Defaults to true. */
  active?: boolean;
  by?: string; // creator email
  on?: string; // ISO created timestamp
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
  routes: Route[];
  availability: Availability[];
  dsrVisits: DsrVisit[];
  /** Optional so older backups (without it) still restore cleanly. */
  customerFeedback?: CustomerFeedback[];
  /** Optional so older backups (without it) still restore cleanly. */
  clients?: Client[];
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

/** Chicks the order is billed for — the delivered count once it has been
 *  short-delivered, otherwise the ordered amount. */
export function billedChicks(
  order: Pick<Order, "chicks"> & { delivered?: number }
): number {
  return order.delivered ?? order.chicks;
}

/** Free chicks (2% extra + compensation) are not charged. A short delivery is
 *  billed only for the chicks actually handed over. */
export function orderTotal(
  order: Pick<Order, "chicks" | "price"> & { delivered?: number }
): number {
  return billedChicks(order) * order.price;
}

export function paidAmount(order: Pick<Order, "payments">): number {
  // Voided (Admin-rejected) payments don't count toward what's been paid.
  return order.payments.reduce((sum, p) => (p.voided ? sum : sum + p.amt), 0);
}

/** Outstanding cash on this order. Applied customer credit counts toward it,
 *  so a credit-funded order reads as paid. */
export function balance(
  order: Pick<Order, "chicks" | "price" | "payments"> & {
    delivered?: number;
    creditApplied?: number;
  }
): number {
  return orderTotal(order) - paidAmount(order) - (order.creditApplied ?? 0);
}

export function isFullyPaid(
  order: Pick<Order, "chicks" | "price" | "payments"> & {
    delivered?: number;
    creditApplied?: number;
  }
): boolean {
  return balance(order) <= 0;
}

// ---------------------------------------------------------------------------
// Customer credit (wallet)
// ---------------------------------------------------------------------------

/** Digits-only phone, so "0781 398 821" and "250781398821" compare loosely. */
function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("250") ? d.slice(3) : d.replace(/^0/, "");
}

/** The same customer — matched on phone (loose) and name (case-insensitive). */
export function sameCustomer(
  a: Pick<Order, "phone" | "name">,
  b: Pick<Order, "phone" | "name">
): boolean {
  return (
    phoneDigits(a.phone) === phoneDigits(b.phone) &&
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase()
  );
}

/**
 * A customer's available credit in RWF: cash they have paid beyond the value of
 * chicks actually delivered/committed to them, summed across their orders. It
 * grows when they overpay or are short-delivered, and is consumed as later
 * orders bill against them. Refunded/rejected orders don't count; pass the
 * order being created/paid as `excludeId` to get the credit available *before*
 * it draws down.
 */
export function customerCredit(
  orders: Order[],
  ref: Pick<Order, "phone" | "name">,
  excludeId?: string
): number {
  const mine = orders.filter(
    (o) =>
      o.status !== "refunded" &&
      o.status !== "rejected" &&
      o.id !== excludeId &&
      sameCustomer(o, ref)
  );
  const raw = mine.reduce((s, o) => s + paidAmount(o) - orderTotal(o), 0);
  return Math.max(0, raw);
}

export function allVerified(order: Pick<Order, "payments">): boolean {
  // Voided payments are ignored — they neither count nor block delivery.
  const active = order.payments.filter((p) => !p.voided);
  return active.length > 0 && active.every((p) => p.verified);
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
