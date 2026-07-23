/**
 * Role-based visibility and navigation.
 *
 * `canSee` is the central gate deciding whether a user may see an order.
 * `navForRole` returns the ordered nav items for a role.
 */

import type { Order, Role, User } from "./types";
import { HATCHERY_ORDER_ROLES } from "./types";

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
    case "Accountant":
      // Finance oversight — every order, across products and zones.
      return true;
    default:
      // Hatchery coordination/oversight roles see all orders for allocation.
      return HATCHERY_ORDER_ROLES.includes(user.role);
  }
}

export function visibleOrders(orders: Order[], user: User): Order[] {
  return orders.filter((o) => canSee(o, user));
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

const H_ALL: NavItem[] = [
  H_DASH, H_RECEPTION, H_STORE, H_FUMIGATION, H_MACHINES, H_OPERATORS, H_BATCHES,
  H_CANDLING, H_HATCH, H_BOXES, H_VACCINATION, H_VAC_REQUESTS,
  H_FARM_VISITS, H_COORD, H_CHICKS, H_INVENTORY, H_SPAREPARTS, H_BIO, H_MAINT,
  H_HANDOVER,
];

const NAV: Record<Role, NavItem[]> = {
  Admin: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Users", href: "/users" },
    { label: "DSRs", href: "/dsrs" },
    { label: "Clients", href: "/clients" },
    { label: "Requests", href: "/requests" },
    { label: "Farm visits", href: "/farm-visits" },
    { label: "Availability", href: "/availability" },
    { label: "Commission", href: "/commission" },
    { label: "Verification", href: "/verification" },
    { label: "Finance", href: "/finance" },
    { label: "Accounting", href: "/accounting" },
    { label: "Delivery planning", href: "/planning" },
    { label: "Orders", href: "/orders" },
    { label: "Agrishow", href: "/agrishow" },
    ...H_ALL,
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
    { label: "Commission", href: "/commission" },
    { label: "Delivery planning", href: "/planning" },
    { label: "Zone Orders", href: "/orders" },
  ],
  "Ross Payment Checker": [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Clients", href: "/clients" },
    { label: "Verification", href: "/verification" },
    { label: "Delivery planning", href: "/planning" },
    { label: "Orders", href: "/orders" },
    { label: "Agrishow", href: "/agrishow" },
  ],

  // ---- Finance ----
  "Accountant": [
    { label: "Finance", href: "/finance" },
    { label: "Accounting", href: "/accounting" },
    { label: "Dashboard", href: "/dashboard" },
    { label: "Clients", href: "/clients" },
    { label: "Orders", href: "/orders" },
    { label: "Verification", href: "/verification" },
    { label: "Commission", href: "/commission" },
    H_INVENTORY,
    H_SPAREPARTS,
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
  "Hatchery Manager": H_ALL,
  // Specialised in machine upkeep — no egg reception, batches/setting,
  // candling, coordination, chick inventory or general inventory.
  "Operations Manager": [
    H_DASH, H_STORE, H_FUMIGATION, H_MACHINES, H_OPERATORS, H_HATCH, H_BOXES,
    H_VACCINATION, H_VAC_REQUESTS, H_FARM_VISITS, H_SPAREPARTS, H_BIO, H_MAINT,
  ],
  "Hatchery Operations Manager": [
    H_DASH, H_MACHINES, H_MAINT, H_SPAREPARTS, H_BIO, H_HATCH, H_BOXES,
  ],
  // Shift handover is limited to the Hatchery Manager and Production Technician.
  "Production Technician": [
    H_DASH, H_RECEPTION, H_FUMIGATION, H_MACHINES, H_BATCHES, H_CANDLING, H_HATCH, H_HANDOVER,
  ],
  // Shared tablet account. No side menu — everything is launched from the
  // attendant home hub. No inventory page, but box making shows live stock.
  "Hatchery Attendant": [
    { label: "Home", href: "/hatchery/attendant" },
    H_STORE,
    { label: "Record machines", href: "/hatchery/machines" },
    { label: "Box making", href: "/hatchery/boxes" },
    H_BIO,
  ],
  "Hatchery Veterinary": [
    H_DASH, H_FARM_VISITS, H_VAC_REQUESTS, H_VACCINATION, H_BIO,
  ],
  "Maintenance Technician": [
    H_DASH, H_MACHINES, H_MAINT, H_SPAREPARTS,
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
