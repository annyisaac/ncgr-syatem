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

// ---------------------------------------------------------------------------
// Districts -> sectors (official Rwandan administrative sectors, 416 total)
// Source: ngabovictor/Rwanda dataset. Used to offer a sector dropdown when
// taking an order, keyed off the chosen district.
// ---------------------------------------------------------------------------

export const SECTORS_BY_DISTRICT: Record<string, string[]> = {
  Bugesera: ["Gashora", "Juru", "Kamabuye", "Mareba", "Mayange", "Musenyi", "Mwogo", "Ngeruka", "Ntarama", "Nyamata", "Nyarugenge", "Rilima", "Ruhuha", "Rweru", "Shyara"],
  Burera: ["Bungwe", "Butaro", "Cyanika", "Cyeru", "Gahunga", "Gatebe", "Gitovu", "Kagogo", "Kinoni", "Kinyababa", "Kivuye", "Nemba", "Rugarama", "Rugengabari", "Ruhunde", "Rusarabuye", "Rwerere"],
  Gakenke: ["Busengo", "Coko", "Cyabingo", "Gakenke", "Gashenyi", "Janja", "Kamubuga", "Karambo", "Kivuruga", "Mataba", "Minazi", "Mugunga", "Muhondo", "Muyongwe", "Muzo", "Nemba", "Ruli", "Rusasa", "Rushashi"],
  Gasabo: ["Bumbogo", "Gatsata", "Gikomero", "Gisozi", "Jabana", "Jali", "Kacyiru", "Kimihurura", "Kimironko", "Kinyinya", "Ndera", "Nduba", "Remera", "Rusororo", "Rutunga"],
  Gatsibo: ["Gasange", "Gatsibo", "Gitoki", "Kabarore", "Kageyo", "Kiramuruzi", "Kiziguro", "Muhura", "Murambi", "Ngarama", "Nyagihanga", "Remera", "Rugarama", "Rwimbogo"],
  Gicumbi: ["Bukure", "Bwisige", "Byumba", "Cyumba", "Giti", "Kageyo", "Kaniga", "Manyagiro", "Miyove", "Mukarange", "Muko", "Mutete", "Nyamiyaga", "Nyankenke", "Rubaya", "Rukomo", "Rushaki", "Rutare", "Ruvune", "Rwamiko", "Shangasha"],
  Gisagara: ["Gikonko", "Gishubi", "Kansi", "Kibirizi", "Kigembe", "Mamba", "Muganza", "Mugombwa", "Mukindo", "Musha", "Ndora", "Nyanza", "Save"],
  Huye: ["Gishamvu", "Huye", "Karama", "Kigoma", "Kinazi", "Maraba", "Mbazi", "Mukura", "Ngoma", "Ruhashya", "Rusatira", "Rwaniro", "Simbi", "Tumba"],
  Kamonyi: ["Gacurabwenge", "Karama", "Kayenzi", "Kayumbu", "Mugina", "Musambira", "Ngamba", "Nyamiyaga", "Nyarubaka", "Rugarika", "Rukoma", "Runda"],
  Karongi: ["Bwishyura", "Gashari", "Gishyita", "Gitesi", "Mubuga", "Murambi", "Murundi", "Mutuntu", "Rubengera", "Rugabano", "Ruganda", "Rwankuba", "Twumba"],
  Kayonza: ["Gahini", "Kabare", "Kabarondo", "Mukarange", "Murama", "Murundi", "Mwiri", "Ndego", "Nyamirama", "Rukara", "Ruramira", "Rwinkwavu"],
  Kicukiro: ["Gahanga", "Gatenga", "Gikondo", "Kagarama", "Kanombe", "Kicukiro", "Kigarama", "Masaka", "Niboye", "Nyarugunga"],
  Kirehe: ["Gahara", "Gatore", "Kigarama", "Kigina", "Kirehe", "Mahama", "Mpanga", "Musaza", "Mushikiri", "Nasho", "Nyamugari", "Nyarubuye"],
  Muhanga: ["Cyeza", "Kabacuzi", "Kibangu", "Kiyumba", "Muhanga", "Mushishiro", "Nyabinoni", "Nyamabuye", "Nyarusange", "Rongi", "Rugendabari", "Shyogwe"],
  Musanze: ["Busogo", "Cyuve", "Gacaca", "Gashaki", "Gataraga", "Kimonyi", "Kinigi", "Muhoza", "Muko", "Musanze", "Nkotsi", "Nyange", "Remera", "Rwaza", "Shingiro"],
  Ngoma: ["Gashanda", "Jarama", "Karembo", "Kazo", "Kibungo", "Mugesera", "Murama", "Mutenderi", "Remera", "Rukira", "Rukumberi", "Rurenge", "Sake", "Zaza"],
  Ngororero: ["Bwira", "Gatumba", "Hindiro", "Kabaya", "Kageyo", "Kavumu", "Matyazo", "Muhanda", "Muhororo", "Ndaro", "Ngororero", "Nyange", "Sovu"],
  Nyabihu: ["Bigogwe", "Jenda", "Jomba", "Kabatwa", "Karago", "Kintobo", "Mukamira", "Muringa", "Rambura", "Rugera", "Rurembo", "Shyira"],
  Nyagatare: ["Gatunda", "Karama", "Karangazi", "Katabagemu", "Kiyombe", "Matimba", "Mimuri", "Mukama", "Musheri", "Nyagatare", "Rukomo", "Rwempasha", "Rwimiyaga", "Tabagwe"],
  Nyamagabe: ["Buruhukiro", "Cyanika", "Gasaka", "Gatare", "Kaduha", "Kamegeri", "Kibirizi", "Kibumbwe", "Kitabi", "Mbazi", "Mugano", "Musange", "Musebeya", "Mushubi", "Nkomane", "Tare", "Uwinkingi"],
  Nyamasheke: ["Bushekeri", "Bushenge", "Cyato", "Gihombo", "Kagano", "Kanjongo", "Karambi", "Karengera", "Kirimbi", "Macuba", "Mahembe", "Nyabitekeri", "Rangiro", "Ruharambuga", "Shangi"],
  Nyanza: ["Busasamana", "Busoro", "Cyabakamyi", "Kibilizi", "Kigoma", "Mukingo", "Muyira", "Ntyazo", "Nyagisozi", "Rwabicuma"],
  Nyarugenge: ["Gitega", "Kanyinya", "Kigali", "Kimisagara", "Mageregere", "Muhima", "Nyakabanda", "Nyamirambo", "Nyarugenge", "Rwezamenyo"],
  Nyaruguru: ["Busanze", "Cyahinda", "Kibeho", "Kivu", "Mata", "Muganza", "Munini", "Ngera", "Ngoma", "Nyabimata", "Nyagisozi", "Ruheru", "Ruramba", "Rusenge"],
  Rubavu: ["Bugeshi", "Busasamana", "Cyanzarwe", "Gisenyi", "Kanama", "Kanzenze", "Mudende", "Nyakiriba", "Nyamyumba", "Nyundo", "Rubavu", "Rugerero"],
  Ruhango: ["Bweramana", "Byimana", "Kabagali", "Kinazi", "Kinihira", "Mbuye", "Mwendo", "Ntongwe", "Ruhango"],
  Rulindo: ["Base", "Burega", "Bushoki", "Buyoga", "Cyinzuzi", "Cyungo", "Kinihira", "Kisaro", "Masoro", "Mbogo", "Murambi", "Ngoma", "Ntarabana", "Rukozo", "Rusiga", "Shyorongi", "Tumba"],
  Rusizi: ["Bugarama", "Butare", "Bweyeye", "Gashonga", "Giheke", "Gihundwe", "Gikundamvura", "Gitambi", "Kamembe", "Muganza", "Mururu", "Nkanka", "Nkombo", "Nkungu", "Nyakabuye", "Nyakarenzo", "Nzahaha", "Rwimbogo"],
  Rutsiro: ["Boneza", "Gihango", "Kigeyo", "Kivumu", "Manihira", "Mukura", "Murunda", "Musasa", "Mushonyi", "Mushubati", "Nyabirasi", "Ruhango", "Rusebeya"],
  Rwamagana: ["Fumbwe", "Gahengeri", "Gishali", "Karenge", "Kigabiro", "Muhazi", "Munyaga", "Munyiginya", "Musha", "Muyumbu", "Mwulire", "Nyakaliro", "Nzige", "Rubona"],
};

/** The official sectors of a district (empty if unknown). */
export function sectorsOfDistrict(district: string): string[] {
  return SECTORS_BY_DISTRICT[district] ?? [];
}
