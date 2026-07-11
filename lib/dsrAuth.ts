/** DSR code-login helpers (pure). */

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A unique, human-typable sign-in code, e.g. "DSR-7K2QMN". */
export function genDsrCode(existing: string[]): string {
  let code = "";
  do {
    code = "DSR-" + Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (existing.includes(code));
  return code;
}

/** Deterministic email that backs a DSR's code login (never actually emailed). */
export function dsrAuthEmail(dsrId: string): string {
  return `dsr.${dsrId.replace(/[^a-z0-9]/gi, "").toLowerCase()}@ncgrltd.com`;
}
