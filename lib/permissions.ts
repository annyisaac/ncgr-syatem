/**
 * Role-based visibility and navigation.
 *
 * `canSee` is the central gate deciding whether a user may see an order.
 * `navForRole` returns the ordered nav items for a role.
 */

import type { Order, Product, Role, User, Zone } from "./types";
import { HATCHERY_ORDER_ROLES } from "./types";

/**
 * The single product a role is scoped to for delivery-date filtering and order
 * creation — Ross roles see only Ross, Tetra roles (incl. DSRs) only Tetra.
 * Returns undefined for cross-product roles (Admin, Accountant, …) who see all.
 */
export function productForRole(role: Role): Product | undefined {
  switch (role) {
    case "Tetra Zone Manager":
    case "Tetra Payment Checker":
    case "DSR":
      return "Tetra Super Harco";
    case "Ross Order Receiver":
    case "Ross Payment Checker":
    case "Ross Sales Agent":
      return "Ross 308";
    default:
      return undefined;
  }
}

/** Does an availability date carry chicks for the given product? */
export function dateHasProduct(a: { ross: number; tetra: number }, product?: Product): boolean {
  if (!product) return a.ross > 0 || a.tetra > 0;
  return product === "Ross 308" ? a.ross > 0 : a.tetra > 0;
}

// ---------------------------------------------------------------------------
// Order visibility gate
// ---------------------------------------------------------------------------

export function canSee(order: Order, user: User): boolean {
  switch (user.role) {
    case "Admin":
      return true;
    case "Tetra Zone Manager":
      // A zone manager sees only their own zone's Tetra orders.
      return order.product === "Tetra Super Harco" && order.zone === user.zone;
    case "Tetra Payment Checker":
      // Also a zone-2 manager, but must verify Tetra payments across BOTH zones,
      // so they see every Tetra order (the orders view labels each one's zone).
      return order.product === "Tetra Super Harco";
    case "Ross Order Receiver":
    case "Ross Payment Checker":
      // Ross 308 is one product handled across both zones.
      return order.product === "Ross 308";
    case "Ross Sales Agent":
      // A field agent sees only the Ross 308 orders they collected themselves.
      return order.product === "Ross 308" && (order.by ?? "").toLowerCase() === user.email.toLowerCase();
    case "Accountant":
      // Finance oversight — every order, across products and zones.
      return true;
    case "Logistics Officer":
      // Distribution — needs every order to plan and dispatch deliveries.
      return true;
    default:
      // Hatchery coordination/oversight roles see all orders for allocation.
      return HATCHERY_ORDER_ROLES.includes(user.role);
  }
}

export function visibleOrders(orders: Order[], user: User): Order[] {
  return orders.filter((o) => canSee(o, user));
}

/**
 * Whether a standalone client record (a client with no visible orders) may be
 * seen by this user. Mirrors `canSee`: cross-product roles see all; a
 * product-scoped role sees only its product, and a Tetra Zone Manager only its
 * own zone. Clients derived from orders are already gated by `visibleOrders`.
 */
export function clientVisible(client: { product?: Product; zone?: Zone }, user: User): boolean {
  const p = productForRole(user.role);
  if (!p) return true; // Admin, Accountant, cross-product roles → all clients
  if (client.product && client.product !== p) return false;
  if (user.role === "Tetra Zone Manager" && client.zone && client.zone !== user.zone) return false;
  return true;
}

/** Roles allowed to add or edit a client record — the same roles that can open
 *  the Clients page. */
export function canWriteClients(role: Role): boolean {
  return canAccess(role, "/clients");
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string;
  href: string;
}

// Hatchery nav building blocks
const H_DASH: NavItem = { label: "Dashboard", href: "/hatchery" };
const H_RECEPTION: NavItem = { label: "Egg reception", href: "/hatchery/reception" };
const H_STORE: NavItem = { label: "Store room", href: "/hatchery/storeroom" };
const H_FUMIGATION: NavItem = { label: "Fumigation", href: "/hatchery/fumigation" };
const H_MACHINES: NavItem = { label: "Machines", href: "/hatchery/machines" };
const H_OPERATORS: NavItem = { label: "Hatchery attendants", href: "/hatchery/operators" };
const H_BATCHES: NavItem = { label: "Batches / setting", href: "/hatchery/batches" };
const H_CANDLING: NavItem = { label: "Candling", href: "/hatchery/candling" };
const H_HATCH: NavItem = { label: "Hatch", href: "/hatchery/hatch" };
const H_BOXES: NavItem = { label: "Boxes", href: "/hatchery/boxes" };
const H_VACCINATION: NavItem = { label: "Vaccination", href: "/hatchery/vaccination" };
const H_FARM_VISITS: NavItem = { label: "Farm visits", href: "/hatchery/farm-visits" };
const H_VAC_REQUESTS: NavItem = { label: "Vaccine requests", href: "/hatchery/vaccine-requests" };
const H_COORD: NavItem = { label: "Coordination", href: "/hatchery/coordination" };
const H_CHICKS: NavItem = { label: "Chick inventory", href: "/hatchery/chicks" };
const H_INVENTORY: NavItem = { label: "Inventory", href: "/hatchery/inventory" };
const H_SPAREPARTS: NavItem = { label: "Spare parts", href: "/hatchery/spareparts" };
const H_BIO: NavItem = { label: "Biosecurity", href: "/hatchery/biosecurity" };
const H_MAINT: NavItem = { label: "Maintenance", href: "/hatchery/maintenance" };
const H_HANDOVER: NavItem = { label: "Shift handover", href: "/hatchery/handover" };
const H_REPORTS: NavItem = { label: "Reports", href: "/hatchery/reports" };

/** Materials & spare-parts request — shared across the request → approval → pay chain. */
const MATERIAL_REQ: NavItem = { label: "Material requests", href: "/logistics/material-requests" };

const H_ALL: NavItem[] = [
  H_DASH, H_RECEPTION, H_STORE, H_FUMIGATION, H_MACHINES, H_OPERATORS, H_BATCHES,
  H_CANDLING, H_HATCH, H_BOXES, H_VACCINATION, H_VAC_REQUESTS,
  H_FARM_VISITS, H_COORD, H_CHICKS, H_INVENTORY, H_SPAREPARTS, H_BIO, H_MAINT,
  H_HANDOVER, H_REPORTS,
];

const NAV: Record<Role, NavItem[]> = {
  // Grouped by department in the side menu (AppShell.groupNav): the order here
  // decides the section order — Sales, then Accounting, then Hatchery, then Admin.
  Admin: [
    // Sales
    { label: "Dashboard", href: "/dashboard" },
    { label: "Orders", href: "/orders" },
    { label: "Clients", href: "/clients" },
    { label: "DSRs", href: "/dsrs" },
    { label: "Requests", href: "/requests" },
    { label: "Farm visits", href: "/farm-visits" },
    { label: "Availability", href: "/availability" },
    { label: "Agent quotas", href: "/agent-quotas" },
    { label: "Delivery planning", href: "/planning" },
    { label: "Commission", href: "/commission" },
    { label: "Verification", href: "/verification" },
    { label: "Customer feedback", href: "/feedback" },
    { label: "Agrishow", href: "/agrishow" },
    // Accounting
    { label: "Finance", href: "/finance" },
    { label: "Accounting", href: "/accounting" },
    { label: "Purchasing", href: "/purchasing" },
    { label: "Payroll", href: "/payroll" },
    { label: "Fixed Assets", href: "/assets" },
    { label: "Tax", href: "/tax" },
    { label: "Budgets", href: "/budgets" },
    { label: "Banking", href: "/banking" },
    { label: "Costing & COGS", href: "/costing" },
    // Logistics
    { label: "Logistics", href: "/logistics" },
    { label: "Dispatch", href: "/logistics/dispatch" },
    { label: "Procurement", href: "/logistics/purchasing" },
    MATERIAL_REQ,
    { label: "Trips & fuel", href: "/logistics/trips" },
    { label: "Transfers & returns", href: "/logistics/transfers" },
    { label: "Logistics expenses", href: "/logistics/expenses" },
    { label: "Logistics reports", href: "/logistics/reports" },
    { label: "Vehicles", href: "/logistics/vehicles" },
    { label: "Drivers", href: "/logistics/drivers" },
    // Parent stock
    { label: "Breeder farm", href: "/parent-stock" },
    { label: "Daily records", href: "/parent-stock/daily" },
    { label: "Growth & uniformity", href: "/parent-stock/growth" },
    { label: "Male breeders", href: "/parent-stock/males" },
    { label: "Female breeders", href: "/parent-stock/females" },
    { label: "Production houses", href: "/parent-stock/production" },
    { label: "Egg transfers", href: "/parent-stock/eggs" },
    { label: "Farm health", href: "/parent-stock/health" },
    { label: "Farm inventory", href: "/parent-stock/inventory" },
    { label: "Feed", href: "/parent-stock/feed" },
    { label: "Production costing", href: "/parent-stock/costing" },
    { label: "Farm reports", href: "/parent-stock/reports" },
    // Hatchery
    ...H_ALL,
    // Admin
    { label: "Staff & attendance", href: "/staff" },
    { label: "Users", href: "/users" },
  ],
  "Tetra Zone Manager": [
    { label: "Dashboard", href: "/dashboard" },
    { label: "My DSRs", href: "/dsrs" },
    { label: "Clients", href: "/clients" },
    { label: "Requests", href: "/requests" },
    { label: "Farm visits", href: "/farm-visits" },
    { label: "Tetra batches", href: "/tetra-batches" },
    { label: "Commission", href: "/commission" },
    { label: "Delivery planning", href: "/planning" },
    { label: "Zone Orders", href: "/orders" },
  ],
  "Ross Order Receiver": [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Clients", href: "/clients" },
    { label: "Ross batches", href: "/ross-batches" },
    { label: "Commission", href: "/commission" },
    { label: "Delivery planning", href: "/planning" },
    { label: "Orders", href: "/orders" },
  ],
  // Also acts as the zone manager for its zone (set the account's zone), so it
  // carries the zone-manager pages on top of payment verification.
  "Tetra Payment Checker": [
    { label: "Dashboard", href: "/dashboard" },
    { label: "My DSRs", href: "/dsrs" },
    { label: "Clients", href: "/clients" },
    { label: "Requests", href: "/requests" },
    { label: "Farm visits", href: "/farm-visits" },
    { label: "Tetra batches", href: "/tetra-batches" },
    { label: "Verification", href: "/verification" },
    { label: "Customer feedback", href: "/feedback" },
    { label: "Commission", href: "/commission" },
    { label: "Delivery planning", href: "/planning" },
    { label: "Zone Orders", href: "/orders" },
  ],
  "Ross Payment Checker": [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Clients", href: "/clients" },
    { label: "Ross batches", href: "/ross-batches" },
    { label: "Verification", href: "/verification" },
    { label: "Customer feedback", href: "/feedback" },
    { label: "Delivery planning", href: "/planning" },
    { label: "Orders", href: "/orders" },
    { label: "Agrishow", href: "/agrishow" },
  ],
  // Ross 308 field sales agent — collects orders + first payment in the field,
  // limited to a per-delivery-date chick quota the Admin assigns.
  "Ross Sales Agent": [
    { label: "Dashboard", href: "/agent" },
    { label: "New order", href: "/agent/order" },
    { label: "My orders", href: "/agent/orders" },
  ],

  // ---- Finance ----
  "Accountant": [
    { label: "Finance", href: "/finance" },
    { label: "Accounting", href: "/accounting" },
    { label: "Purchasing", href: "/purchasing" },
    { label: "Payroll", href: "/payroll" },
    { label: "Fixed Assets", href: "/assets" },
    { label: "Tax", href: "/tax" },
    { label: "Budgets", href: "/budgets" },
    { label: "Banking", href: "/banking" },
    { label: "Costing & COGS", href: "/costing" },
    { label: "Dashboard", href: "/dashboard" },
    { label: "Clients", href: "/clients" },
    { label: "Orders", href: "/orders" },
    { label: "Verification", href: "/verification" },
    { label: "Commission", href: "/commission" },
    // Approves and posts logistics expenses submitted by Logistics.
    { label: "Logistics expenses", href: "/logistics/expenses" },
    // Authorises the spend and files paid material/spare-part requests.
    MATERIAL_REQ,
    H_INVENTORY,
    H_SPAREPARTS,
  ],

  // ---- Logistics ----
  // Distribution & procurement coordination. Records and submits; the
  // Accountant verifies and posts. Sees orders and delivery planning to
  // dispatch, but no ledger, payroll or financial reports.
  "Logistics Officer": [
    { label: "Dashboard", href: "/logistics" },
    { label: "Dispatch", href: "/logistics/dispatch" },
    { label: "Deliveries", href: "/planning" },
    { label: "Orders", href: "/orders" },
    { label: "Procurement", href: "/logistics/purchasing" },
    MATERIAL_REQ,
    { label: "Trips & fuel", href: "/logistics/trips" },
    { label: "Transfers & returns", href: "/logistics/transfers" },
    { label: "Expenses", href: "/logistics/expenses" },
    { label: "Reports", href: "/logistics/reports" },
    { label: "Vehicles", href: "/logistics/vehicles" },
    { label: "Drivers", href: "/logistics/drivers" },
  ],

  // ---- Parent stock (breeder farm) ----
  // Manages the breeder farm: male & female flocks, production houses, fertile
  // eggs, farm operations. Records and submits; capital/payroll/payments stay
  // with Operations, Finance or the CEO.
  "Parent Stock Manager": [
    { label: "Dashboard", href: "/parent-stock" },
    { label: "Daily records", href: "/parent-stock/daily" },
    { label: "Growth & uniformity", href: "/parent-stock/growth" },
    { label: "Male breeders", href: "/parent-stock/males" },
    { label: "Female breeders", href: "/parent-stock/females" },
    { label: "Production houses", href: "/parent-stock/production" },
    { label: "Egg transfers", href: "/parent-stock/eggs" },
    { label: "Health", href: "/parent-stock/health" },
    { label: "Inventory", href: "/parent-stock/inventory" },
    { label: "Feed", href: "/parent-stock/feed" },
    { label: "Production costing", href: "/parent-stock/costing" },
    { label: "Reports", href: "/parent-stock/reports" },
  ],

  // ---- DSR portal (code + single-device login) ----
  DSR: [
    { label: "Home", href: "/dsr" },
    { label: "Orders", href: "/dsr/orders" },
    { label: "Farm visits", href: "/dsr/visits" },
    { label: "My requests", href: "/requests" },
    { label: "Commission", href: "/dsr/commission" },
  ],

  // ---- Hatchery roles ----
  "Hatchery Manager": [...H_ALL, { label: "Availability", href: "/availability" }, MATERIAL_REQ],
  // Specialised in machine upkeep — no egg reception, batches/setting,
  // candling, coordination, chick inventory or general inventory.
  "Operations Manager": [
    H_DASH, H_STORE, H_FUMIGATION, H_MACHINES, H_OPERATORS, H_HATCH, H_BOXES,
    H_VACCINATION, H_VAC_REQUESTS, H_FARM_VISITS, H_SPAREPARTS, H_BIO, H_MAINT,
    // Approves purchase requests and purchase orders raised by Logistics,
    // and verifies logistics expenses before Finance.
    { label: "Procurement approvals", href: "/logistics/purchasing" },
    { label: "Logistics expenses", href: "/logistics/expenses" },
    MATERIAL_REQ,
    H_REPORTS,
  ],
  // Runs the production floor end-to-end (second to the Hatchery Manager):
  // the full reception → set → candle → hatch → count/box → vaccinate flow,
  // plus machines, maintenance, spare parts and biosecurity. Admin/vet/sales
  // items (general inventory, vaccine requests, farm visits, coordination,
  // shift handover) stay with the Hatchery Manager and their owners.
  "Hatchery Operations Manager": [
    H_DASH, H_RECEPTION, H_STORE, H_FUMIGATION, H_MACHINES, H_BATCHES,
    H_CANDLING, H_HATCH, H_BOXES, H_VACCINATION, H_CHICKS, H_SPAREPARTS, H_BIO, H_MAINT,
    MATERIAL_REQ, H_REPORTS,
  ],
  // Shift handover is limited to the Hatchery Manager and Production Technician.
  "Production Technician": [
    H_DASH, H_RECEPTION, H_FUMIGATION, H_MACHINES, H_BATCHES, H_CANDLING, H_HATCH, H_HANDOVER,
    { label: "Availability", href: "/availability" },
  ],
  // Shared tablet account. No side menu — everything is launched from the
  // attendant home hub. No inventory page, but box making shows live stock.
  "Hatchery Attendant": [
    { label: "Home", href: "/hatchery/attendant" },
    H_STORE,
    { label: "Record machines", href: "/hatchery/machines" },
    { label: "Box making", href: "/hatchery/boxes" },
    H_BIO,
    H_HANDOVER,
  ],
  "Hatchery Veterinary": [
    H_DASH, { label: "Customer follow-up", href: "/feedback" },
    H_FARM_VISITS, H_VAC_REQUESTS, H_VACCINATION, H_BIO,
  ],
  "Maintenance Technician": [
    H_DASH, H_MACHINES, H_MAINT, H_SPAREPARTS, MATERIAL_REQ,
  ],
  "Hatchery Sales & Coordination Officer": [
    H_DASH, H_COORD, H_FARM_VISITS, H_CHICKS, H_INVENTORY, H_BATCHES,
  ],
};

/** Landing route after login for a role. */
export function homeForRole(role: Role): string {
  return NAV[role]?.[0]?.href ?? "/dashboard";
}

export function navForRole(role: Role): NavItem[] {
  return NAV[role] ?? [];
}

/** Whether a role is allowed to reach a given route (prefix match). */
export function canAccess(role: Role, pathname: string): boolean {
  const items = navForRole(role);
  // /orders/new and /orders/[id] both fall under the /orders nav item.
  // Everyone can reach their own profile.
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return true;
  return items.some(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/")
  ) || pathname.startsWith("/dsrs/");
}
