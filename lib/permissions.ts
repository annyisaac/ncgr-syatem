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
      // Only Tetra orders in the manager's own zone.
      return order.product === "Tetra Super Harco" && order.zone === user.zone;
    case "Ross Order Receiver":
      return order.product === "Ross 308";
    case "Tetra Payment Checker":
      return order.product === "Tetra Super Harco";
    case "Ross Payment Checker":
      return order.product === "Ross 308";
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
const H_DASH: NavItem = { label: "Hatchery", href: "/hatchery" };
const H_BATCHES: NavItem = { label: "Batches", href: "/hatchery/batches" };
const H_MONITOR: NavItem = { label: "Monitoring", href: "/hatchery/monitoring" };
const H_HEALTH: NavItem = { label: "Health & Vaccination", href: "/hatchery/health" };
const H_BIO: NavItem = { label: "Biosecurity", href: "/hatchery/biosecurity" };
const H_MAINT: NavItem = { label: "Maintenance", href: "/hatchery/maintenance" };
const H_COORD: NavItem = { label: "Coordination", href: "/hatchery/coordination" };

const NAV: Record<Role, NavItem[]> = {
  Admin: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Users", href: "/users" },
    { label: "DSRs", href: "/dsrs" },
    { label: "Commission", href: "/commission" },
    { label: "Verification", href: "/verification" },
    { label: "Deliveries", href: "/deliveries" },
    { label: "Orders", href: "/orders" },
    { label: "New Order", href: "/orders/new" },
    H_DASH, H_BATCHES, H_MONITOR, H_HEALTH, H_BIO, H_MAINT, H_COORD,
  ],
  "Tetra Zone Manager": [
    { label: "Dashboard", href: "/dashboard" },
    { label: "My DSRs", href: "/dsrs" },
    { label: "Commission", href: "/commission" },
    { label: "New Order", href: "/orders/new" },
    { label: "Deliveries", href: "/deliveries" },
    { label: "Zone Orders", href: "/orders" },
  ],
  "Ross Order Receiver": [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Commission", href: "/commission" },
    { label: "New Order", href: "/orders/new" },
    { label: "Deliveries", href: "/deliveries" },
    { label: "Orders", href: "/orders" },
  ],
  "Tetra Payment Checker": [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Verification", href: "/verification" },
    { label: "Deliveries", href: "/deliveries" },
    { label: "Orders", href: "/orders" },
  ],
  "Ross Payment Checker": [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Verification", href: "/verification" },
    { label: "Deliveries", href: "/deliveries" },
    { label: "Orders", href: "/orders" },
  ],

  // ---- Hatchery roles ----
  "Hatchery Manager": [
    { ...H_DASH, label: "Dashboard" },
    H_BATCHES, H_MONITOR, H_HEALTH, H_BIO, H_MAINT, H_COORD,
  ],
  "Hatchery Operations Manager": [
    { ...H_DASH, label: "Dashboard" },
    H_BATCHES, H_MONITOR, H_COORD,
  ],
  "Production Technician": [
    { ...H_DASH, label: "Dashboard" },
    H_BATCHES,
  ],
  "Hatchery Attendant": [
    { ...H_DASH, label: "Dashboard" },
    H_MONITOR, H_BIO,
  ],
  "Hatchery Veterinary": [
    { ...H_DASH, label: "Dashboard" },
    H_HEALTH, H_BIO, H_BATCHES,
  ],
  "Maintenance Technician": [
    { ...H_DASH, label: "Dashboard" },
    H_MAINT,
  ],
  "Hatchery Sales & Coordination Officer": [
    { ...H_DASH, label: "Dashboard" },
    H_COORD, H_BATCHES,
  ],
  "Operations Manager": [
    { ...H_DASH, label: "Dashboard" },
    H_BATCHES, H_MONITOR, H_HEALTH, H_BIO, H_MAINT, H_COORD,
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
  // /orders/new is its own item; /orders/[id] falls under /orders.
  // Everyone can reach their own profile.
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return true;
  return items.some(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/")
  ) || pathname.startsWith("/dsrs/");
}
