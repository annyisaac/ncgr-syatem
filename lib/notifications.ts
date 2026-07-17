import type { AppNotification, Role } from "./types";

/**
 * Where clicking a notification should take the user: the page that actually
 * deals with what happened, deep-linked to the order where we can.
 */
export function notificationHref(n: AppNotification, role: Role): string {
  // The order is gone — deep-linking to it would show an empty list.
  if (n.type === "deleted") return role === "DSR" ? "/dsr/orders" : "/orders";

  // DSRs only have their own order list.
  if (role === "DSR") return "/dsr/orders";

  const isChecker = role === "Tetra Payment Checker" || role === "Ross Payment Checker";
  // A payment is the checker's/admin's job — send them where they verify it.
  if (n.type === "payment" && (isChecker || role === "Admin")) return "/verification";
  // A reschedule is a delivery-planning change.
  if (n.type === "reschedule") return "/planning";

  return n.orderId ? `/orders?order=${encodeURIComponent(n.orderId)}` : "/orders";
}
