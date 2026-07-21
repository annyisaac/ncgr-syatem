/**
 * Report generation & data portability.
 *
 * jspdf / jspdf-autotable / xlsx are browser libraries and are imported
 * dynamically on the client only.
 */

import { COMPANY, formatRWF } from "./config";
import { formatDate, formatDateTime, nowISO } from "./format";
import {
  balance,
  extra2,
  orderTotal,
  paidAmount,
  toDeliver,
  type Database,
  type Order,
} from "./types";
import type { DSRCommissionRow } from "./commission";
import type { ClientRecord } from "./clients";
import type { EventRegistration } from "./events";

/** "2026-08" → "Aug 2026". Empty/invalid → "". */
function monthLabel(m?: string): string {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return "";
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Shared PDF header / footer
// ---------------------------------------------------------------------------

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(COMPANY.logoPath);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const GOLD: [number, number, number] = [212, 160, 23];
const INK: [number, number, number] = [28, 26, 22];

interface DocBundle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  autoTable: any;
  startY: number;
  logo: string | null;
}

/**
 * Stamp the logo faintly across the centre of every page, then save. Called at
 * the very end so it covers pages autoTable added. This is what puts the
 * company logo — as a watermark — on every page of every generated document.
 */
function finalizeAndSave(doc: DocBundle["doc"], logo: string | null, fileName: string) {
  if (logo) {
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    // Match the company's Word watermark: the full logo (its own aspect ratio,
    // not squished), large and centred, faded to a light-grey wash on every page.
    let ratio = 549 / 454; // logo.png intrinsic ratio, overridden below if readable
    try {
      const props = doc.getImageProperties(logo);
      if (props?.width && props?.height) ratio = props.width / props.height;
    } catch {
      /* fall back to the known logo ratio */
    }
    const w = pw * 0.72;
    const h = w / ratio;
    const x = (pw - w) / 2;
    const y = (ph - h) / 2;
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      try {
        doc.saveGraphicsState();
        doc.setGState(doc.GState({ opacity: 0.09 }));
        doc.addImage(logo, "PNG", x, y, w, h);
        doc.restoreGraphicsState();
      } catch {
        /* ignore watermark errors */
      }
    }
  }
  doc.save(fileName);
}

async function brandedDoc(
  title: string,
  metaLines: string[],
  orientation: "landscape" | "portrait" = "landscape"
): Promise<DocBundle> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const logo = await loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", 40, 28, 46, 46);
    } catch {
      /* ignore image errors */
    }
  }

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(COMPANY.name, 98, 44);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(COMPANY.address, 98, 56);
  doc.text(`${COMPANY.email}  ·  Tel: ${COMPANY.tel}`, 98, 67);
  doc.text(`TIN: ${COMPANY.tin}`, 98, 78);

  doc.setFont("helvetica", "italic");
  doc.setTextColor(...GOLD);
  doc.setFontSize(10);
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.text(COMPANY.tagline, pageWidth - 40, 44, { align: "right" });

  // Gold rule
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(2);
  doc.line(40, 84, pageWidth - 40, 84);

  // Title + metadata
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, 40, 104);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let y = 118;
  doc.text(`Generated: ${formatDateTime(nowISO())}`, 40, y);
  for (const line of metaLines) {
    y += 12;
    doc.text(line, 40, y);
  }

  return { doc, autoTable, startY: y + 14, logo };
}

function addSignatures(doc: DocBundle["doc"]) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 50 : 400;
  const finalY = Math.min(y, doc.internal.pageSize.getHeight() - 60);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.5);
  doc.setFontSize(9);
  doc.setTextColor(...INK);

  doc.line(40, finalY, 220, finalY);
  doc.text("Prepared by (name & signature)", 40, finalY + 14);

  doc.line(pageWidth - 260, finalY, pageWidth - 40, finalY);
  doc.text("Operations Manager (name & signature)", pageWidth - 260, finalY + 14);
}

// ---------------------------------------------------------------------------
// PDF: Delivery & Payment report
// ---------------------------------------------------------------------------

export async function deliveryPaymentPDF(
  orders: Order[],
  dateLabel: string
): Promise<void> {
  const { doc, autoTable, startY, logo } = await brandedDoc(
    "Delivery & Payment Report",
    [`Delivery date: ${dateLabel}`, `Orders: ${orders.length}`]
  );

  const body = orders.map((o) => [
    formatDate(o.date),
    o.name,
    o.district,
    o.sector,
    o.product,
    o.chicks,
    extra2(o),
    o.comp,
    toDeliver(o),
    orderTotal(o),
    paidAmount(o),
    balance(o),
    o.status,
  ]);

  const sum = (fn: (o: Order) => number) => orders.reduce((s, o) => s + fn(o), 0);

  autoTable(doc, {
    startY,
    head: [[
      "Date", "Client", "District", "Sector", "Product",
      "Chicks", "2% Extra", "Comp", "To Deliver", "Total", "Paid", "Balance", "Status",
    ]],
    body,
    foot: [[
      "Totals", "", "", "", "",
      sum((o) => o.chicks),
      sum((o) => extra2(o)),
      sum((o) => o.comp),
      sum((o) => toDeliver(o)),
      sum((o) => orderTotal(o)),
      sum((o) => paidAmount(o)),
      sum((o) => balance(o)),
      "",
    ]],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: GOLD, textColor: INK, fontStyle: "bold" },
    footStyles: { fillColor: [240, 238, 232], textColor: INK, fontStyle: "bold" },
    theme: "grid",
  });

  addSignatures(doc);
  finalizeAndSave(doc, logo, `NCGR-Delivery-Payment-${dateLabel.replace(/\s+/g, "_")}.pdf`);
}

// ---------------------------------------------------------------------------
// PDF: Orders report (from a dashboard / date filter)
// ---------------------------------------------------------------------------

export async function ordersPDF(orders: Order[], filterLabel: string): Promise<void> {
  const { doc, autoTable, startY, logo } = await brandedDoc("Orders Report", [
    `Filter: ${filterLabel}`,
    `Orders: ${orders.length}`,
  ]);

  const body = orders.map((o) => [
    formatDateTime(o.createdAt),
    formatDate(o.date),
    o.product,
    o.name,
    o.phone,
    o.district,
    o.dsr ?? "—",
    o.chicks,
    orderTotal(o),
    paidAmount(o),
    balance(o),
    o.status,
  ]);

  const sum = (fn: (o: Order) => number) => orders.reduce((s, o) => s + fn(o), 0);

  autoTable(doc, {
    startY,
    head: [[
      "Ordered", "Delivery", "Product", "Client", "Phone", "District", "DSR",
      "Chicks", "Total", "Paid", "Balance", "Status",
    ]],
    body,
    foot: [[
      "Totals", "", "", "", "", "", "",
      sum((o) => o.chicks),
      sum((o) => orderTotal(o)),
      sum((o) => paidAmount(o)),
      sum((o) => balance(o)),
      "",
    ]],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: GOLD, textColor: INK, fontStyle: "bold" },
    footStyles: { fillColor: [240, 238, 232], textColor: INK, fontStyle: "bold" },
    theme: "grid",
  });

  addSignatures(doc);
  finalizeAndSave(doc, logo, `NCGR-Orders-${filterLabel.replace(/\s+/g, "_")}.pdf`);
}

// ---------------------------------------------------------------------------
// PDF: Event visitors (Agrishow) report
// ---------------------------------------------------------------------------

export async function visitorsPDF(
  regs: EventRegistration[],
  filterLabel: string
): Promise<void> {
  const { doc, autoTable, startY, logo } = await brandedDoc("Visitor Registrations", [
    `Filter: ${filterLabel}`,
    `Visitors: ${regs.length}`,
  ]);

  const body = regs.map((r) => [
    r.name,
    r.phone,
    r.province ?? "",
    r.district ?? "",
    r.sector ?? "",
    r.category ?? "",
    r.products ?? "",
    r.plannedChicks ? r.plannedChicks.toLocaleString() : "",
    monthLabel(r.purchaseMonth),
    r.contactMethod ?? "",
    r.consent ? "Yes" : "No",
    formatDateTime(r.on),
  ]);

  autoTable(doc, {
    startY,
    head: [[
      "Name", "Phone", "Province", "District", "Sector", "Category",
      "Products", "Chicks", "Buy month", "Contact", "Consent", "Registered",
    ]],
    body,
    styles: { fontSize: 7.5, cellPadding: 2.5 },
    headStyles: { fillColor: GOLD, textColor: INK, fontStyle: "bold" },
    theme: "grid",
  });

  finalizeAndSave(doc, logo, `NCGR-Visitors-${filterLabel.replace(/\s+/g, "_")}.pdf`);
}

// ---------------------------------------------------------------------------
// PDF: DSR Commission report
// ---------------------------------------------------------------------------

export async function commissionPDF(
  rows: DSRCommissionRow[],
  rangeLabel: string
): Promise<void> {
  const { doc, autoTable, startY, logo } = await brandedDoc("DSR Commission Report", [
    `Period: ${rangeLabel}`,
    `DSRs: ${rows.length}`,
  ]);

  const body = rows.map((r) => [
    r.dsrName,
    r.district,
    r.product,
    r.chicks,
    r.amount,
    r.dueAmount + r.initiatedAmount,
    r.paidAmount,
  ]);

  const sum = (fn: (r: DSRCommissionRow) => number) => rows.reduce((s, r) => s + fn(r), 0);

  autoTable(doc, {
    startY,
    head: [["DSR", "District", "Product", "Chicks", "Commission", "To Give", "Given"]],
    body,
    foot: [[
      "Totals", "", "",
      sum((r) => r.chicks),
      sum((r) => r.amount),
      sum((r) => r.dueAmount + r.initiatedAmount),
      sum((r) => r.paidAmount),
    ]],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: GOLD, textColor: INK, fontStyle: "bold" },
    footStyles: { fillColor: [240, 238, 232], textColor: INK, fontStyle: "bold" },
    theme: "grid",
  });

  addSignatures(doc);
  finalizeAndSave(doc, logo, `NCGR-Commission-${rangeLabel.replace(/\s+/g, "_")}.pdf`);
}

// ---------------------------------------------------------------------------
// PDF: Invoice (one order) and Payment proof (one verified payment)
// ---------------------------------------------------------------------------

/** A short two-column key/value block, returns the y after it. */
function labelledBlock(
  doc: DocBundle["doc"],
  rows: [string, string][],
  startY: number
): number {
  doc.setFontSize(10);
  let y = startY;
  for (const [k, v] of rows) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(k, 40, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(v), 190, y);
    y += 16;
  }
  return y;
}

export async function invoicePDF(order: Order): Promise<void> {
  const { doc, autoTable, startY, logo } = await brandedDoc(
    `Invoice — ${order.name}`,
    [
      `Order: ${order.id}`,
      `Ordered: ${formatDateTime(order.createdAt)}`,
      `Delivery date: ${formatDate(order.date)}`,
    ],
    "portrait"
  );

  const afterInfo = labelledBlock(doc, [
    ["Client", order.name],
    ["Phone", order.phone],
    ["District / Sector", `${order.district} · ${order.sector}`],
    ["Product", order.product],
    ["DSR", order.dsr ?? "—"],
  ], startY);

  autoTable(doc, {
    startY: afterInfo + 6,
    head: [["Description", "Qty", "Unit price", "Amount"]],
    body: [
      [`${order.product} chicks`, order.chicks, order.price, orderTotal(order)],
      [`2% extra (free)`, extra2(order), 0, 0],
      [`Compensation (free)`, order.comp, 0, 0],
    ],
    foot: [
      ["Total", order.chicks, "", orderTotal(order)],
      ["Paid", "", "", paidAmount(order)],
      ["Balance", "", "", balance(order)],
    ],
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fillColor: GOLD, textColor: INK, fontStyle: "bold" },
    footStyles: { fillColor: [240, 238, 232], textColor: INK, fontStyle: "bold" },
    theme: "grid",
  });

  addSignatures(doc);
  finalizeAndSave(doc, logo, `NCGR-Invoice-${order.name.replace(/\s+/g, "_")}.pdf`);
}

export async function paymentProofPDF(
  order: Order,
  payment: Order["payments"][number]
): Promise<void> {
  const { doc, startY, logo } = await brandedDoc(
    `Payment Proof — ${order.name}`,
    [`Order: ${order.id}`],
    "portrait"
  );

  const y = labelledBlock(doc, [
    ["Client", order.name],
    ["Phone", order.phone],
    ["Product", order.product],
    ["Transaction ID", payment.checkedRef || payment.ref],
    ["Amount", formatRWF(payment.amt)],
    ["Recorded on", formatDateTime(payment.on)],
    ["Verified", payment.verified ? "Yes" : "No"],
    ["Verified by", payment.verifiedBy ?? "—"],
    ["Verified on", payment.verifiedOn ? formatDateTime(payment.verifiedOn) : "—"],
    ["Order total", formatRWF(orderTotal(order))],
    ["Total paid", formatRWF(paidAmount(order))],
    ["Balance", formatRWF(balance(order))],
  ], startY);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text("This proof confirms the payment recorded against the order above.", 40, y + 8);

  addSignatures(doc);
  finalizeAndSave(doc, logo, `NCGR-Payment-Proof-${order.name.replace(/\s+/g, "_")}.pdf`);
}

// ---------------------------------------------------------------------------
// Excel export / import of orders
// ---------------------------------------------------------------------------

function orderToExcelRow(o: Order): Record<string, string | number> {
  return {
    ID: o.id,
    Product: o.product,
    Province: o.province,
    District: o.district,
    Sector: o.sector,
    DSR: o.dsr ?? "",
    Client: o.name,
    Phone: o.phone,
    Chicks: o.chicks,
    "2% Extra": extra2(o),
    Compensated: o.comp,
    "To Deliver": toDeliver(o),
    Price: o.price,
    Total: orderTotal(o),
    Paid: paidAmount(o),
    Balance: balance(o),
    "Delivery Date": o.date,
    Status: o.status,
    Zone: o.zone,
    "Payment Refs": o.payments.map((p) => `${p.ref}:${p.amt}${p.verified ? "(v)" : ""}`).join(" | "),
    "Created At": o.createdAt,
    "Created By": o.by,
    History: o.history.join(" || "),
  };
}

export async function exportOrdersExcel(orders: Order[]): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = orders.map(orderToExcelRow);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  XLSX.writeFile(wb, `NCGR-Orders-${nowISO().slice(0, 10)}.xlsx`);
}

/**
 * Client list export — one row per client, with their phone and the chicks they
 * ordered. The caller passes clients already built from the selected date range,
 * so the totals reflect exactly that period.
 */
export async function exportClientsExcel(
  clients: ClientRecord[],
  rangeLabel: string
): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = clients.map((c, i) => ({
    "#": i + 1,
    Client: c.name,
    Phone: c.phone || "",
    "Chicks Ordered": c.chicks,
    "To Deliver": c.toDeliver,
    Orders: c.ordersCount,
    Paid: c.paid,
    Balance: c.balance,
    "District(s)": c.districts.join(", "),
    "Sector(s)": c.sectors.join(", "),
    "Last Order": c.lastOrder,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clients");
  const safe = rangeLabel.replace(/[^0-9A-Za-z]+/g, "_").replace(/^_+|_+$/g, "");
  XLSX.writeFile(wb, `NCGR-Clients-${safe || "all"}.xlsx`);
}

/**
 * Best-effort import of an orders Excel file previously exported by this app.
 * Unknown columns are ignored; new orders get fresh audit history.
 */
export async function importOrdersExcel(file: File): Promise<Order[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  return raw.map((r, i) => {
    const num = (k: string) => Number(String(r[k] ?? "0").replace(/[^0-9.-]/g, "")) || 0;
    const str = (k: string) => String(r[k] ?? "").trim();
    const chicks = num("Chicks");
    const paid = num("Paid");
    const payments =
      paid > 0
        ? [{ amt: paid, ref: "IMPORTED", on: nowISO(), by: "import", verified: false }]
        : [];
    return {
      id: str("ID") || `imp_${Date.now()}_${i}`,
      product: (str("Product") as Order["product"]) || "Ross 308",
      province: (str("Province") as Order["province"]) || "Eastern",
      district: str("District"),
      sector: str("Sector"),
      dsr: str("DSR") || undefined,
      name: str("Client"),
      phone: str("Phone"),
      chicks,
      comp: num("Compensated"),
      price: num("Price"),
      date: str("Delivery Date") || nowISO().slice(0, 10),
      status: (str("Status") as Order["status"]) || "pending",
      by: str("Created By") || "import",
      zone: (str("Zone") as Order["zone"]) || "Zone 1",
      created: str("Delivery Date") || nowISO().slice(0, 10),
      createdAt: str("Created At") || nowISO(),
      history: [`${nowISO()} — Imported from Excel`],
      plan: i,
      payments,
    } satisfies Order;
  });
}

// ---------------------------------------------------------------------------
// Backup / restore (JSON of everything)
// ---------------------------------------------------------------------------

export function downloadBackup(db: Database): void {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `NCGR-backup-${nowISO().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readBackup(file: File): Promise<Database> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<Database>;
  return {
    users: parsed.users ?? [],
    dsrs: parsed.dsrs ?? [],
    orders: parsed.orders ?? [],
    commissions: parsed.commissions ?? [],
    statements: parsed.statements ?? [],
    routes: parsed.routes ?? [],
    availability: parsed.availability ?? [],
    dsrVisits: parsed.dsrVisits ?? [],
  };
}

export { formatRWF };
