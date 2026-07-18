/**
 * Static configuration for the NCGR LTD system: company info, Rwandan
 * geography, Tetra zoning rules, commission rates, and the seed admin.
 *
 * Pure data + pure helper functions only — safe to import anywhere.
 */

import type { Province, Zone, Product, User } from "./types";

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export const COMPANY = {
  name: "NCGR LTD",
  address: "Rwamagana – Gishari, Eastern Province, Rwanda",
  email: "info@ncgrltd.com",
  tel: "250781398821",
  tin: "108493553",
  tagline: "Your Partner in Poultry Excellence",
  logoPath: "/logo.png",
} as const;

// ---------------------------------------------------------------------------
// Provinces → districts (real Rwandan administrative divisions)
// ---------------------------------------------------------------------------

export const PROVINCES: Province[] = [
  "Kigali City",
  "Northern",
  "Southern",
  "Eastern",
  "Western",
];

export const DISTRICTS_BY_PROVINCE: Record<Province, string[]> = {
  "Kigali City": ["Gasabo", "Kicukiro", "Nyarugenge"],
  Northern: ["Burera", "Gakenke", "Gicumbi", "Musanze", "Rulindo"],
  Southern: [
    "Gisagara",
    "Huye",
    "Kamonyi",
    "Muhanga",
    "Nyamagabe",
    "Nyanza",
    "Nyaruguru",
    "Ruhango",
  ],
  Eastern: [
    "Bugesera",
    "Gatsibo",
    "Kayonza",
    "Kirehe",
    "Ngoma",
    "Nyagatare",
    "Rwamagana",
  ],
  Western: [
    "Karongi",
    "Ngororero",
    "Nyabihu",
    "Nyamasheke",
    "Rubavu",
    "Rusizi",
    "Rutsiro",
  ],
};

/** Flat list of all 30 districts (used by Ross, which is not zoned). */
export const ALL_DISTRICTS: string[] = PROVINCES.flatMap(
  (p) => DISTRICTS_BY_PROVINCE[p]
);

// ---------------------------------------------------------------------------
// Tetra zoning
// ---------------------------------------------------------------------------
//
// Zone 1 = Northern + Southern provinces.
// Zone 2 = Eastern + Western provinces.
// Kigali City is split by district:
//   Zone 1 -> Kicukiro + Nyarugenge
//   Zone 2 -> Gasabo
// ---------------------------------------------------------------------------

const ZONE_PROVINCES: Record<Zone, Province[]> = {
  "Zone 1": ["Northern", "Southern", "Kigali City"],
  "Zone 2": ["Eastern", "Western", "Kigali City"],
};

const KIGALI_ZONE_DISTRICTS: Record<Zone, string[]> = {
  "Zone 1": ["Kicukiro", "Nyarugenge"],
  "Zone 2": ["Gasabo"],
};

export const ZONES: Zone[] = ["Zone 1", "Zone 2"];

/** Provinces available for selection in a given zone. */
export function zoneProvinces(zone: Zone): Province[] {
  return ZONE_PROVINCES[zone];
}

/**
 * Districts available for a given zone within a province.
 * For Kigali City, only the districts assigned to that zone are returned.
 */
export function zoneDistricts(zone: Zone, province: Province): string[] {
  if (province === "Kigali City") {
    return KIGALI_ZONE_DISTRICTS[zone];
  }
  if (!ZONE_PROVINCES[zone].includes(province)) {
    return [];
  }
  return DISTRICTS_BY_PROVINCE[province];
}

/** The province a district belongs to. */
export function provinceOfDistrict(district: string): Province | undefined {
  return PROVINCES.find((p) =>
    DISTRICTS_BY_PROVINCE[p].includes(district)
  );
}

/**
 * The Tetra zone a district belongs to. Kigali districts are split; all other
 * districts follow their province.
 */
export function zoneOfDistrict(district: string): Zone | undefined {
  if (KIGALI_ZONE_DISTRICTS["Zone 1"].includes(district)) return "Zone 1";
  if (KIGALI_ZONE_DISTRICTS["Zone 2"].includes(district)) return "Zone 2";

  const province = provinceOfDistrict(district);
  if (!province) return undefined;
  if (province === "Northern" || province === "Southern") return "Zone 1";
  if (province === "Eastern" || province === "Western") return "Zone 2";
  return undefined;
}

// ---------------------------------------------------------------------------
// Commission rates (RWF per delivered chick)
// ---------------------------------------------------------------------------

export const COMMISSION_RATE: Record<Product, number> = {
  "Tetra Super Harco": 100,
  "Ross 308": 20,
};

export function commissionRate(product: Product): number {
  return COMMISSION_RATE[product];
}

// ---------------------------------------------------------------------------
// Seed admin (created on first run only)
// ---------------------------------------------------------------------------

export const SEED_ADMIN: User = {
  name: "Isaac",
  email: "isaac@ncgrltd.com",
  role: "Admin",
  password: "ncgr1234",
  active: true,
  created: "2026-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Currency helper
// ---------------------------------------------------------------------------

export function formatRWF(amount: number): string {
  return `${Math.round(amount).toLocaleString("en-US")} RWF`;
}
