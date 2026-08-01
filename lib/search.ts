/**
 * Shared "smart" text search used by the main search bars.
 *
 * Goals: typing the first, middle, or last name (in any order), a partial
 * word, or a small typo still finds the record — accent- and case-insensitive.
 */

/** Lowercase, strip accents, collapse whitespace. */
export function normalize(s: string | undefined | null): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `a` can be turned into `b` within `max` single-character edits. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    let rowMin = dp[0];
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
      if (dp[i] < rowMin) rowMin = dp[i];
    }
    if (rowMin > max) return false;
  }
  return dp[a.length] <= max;
}

/**
 * Order-independent, accent-insensitive, typo-tolerant match. Every whitespace
 * token in `query` must either be a substring of the combined fields, or (for
 * tokens of 4+ characters) be within one edit of some word in the fields.
 */
export function smartMatch(query: string, ...fields: (string | undefined | null)[]): boolean {
  const q = normalize(query);
  if (!q) return true;
  const hay = normalize(fields.join(" "));
  if (!hay) return false;
  const words = hay.split(" ");
  return q.split(" ").every((tok) => {
    if (!tok) return true;
    if (hay.includes(tok)) return true;
    if (tok.length >= 4) return words.some((w) => withinEdits(tok, w, 1));
    return false;
  });
}

/** Up to `limit` distinct labels from `items` that match the query. */
export function suggest<T>(query: string, items: T[], textOf: (x: T) => string, limit = 6): string[] {
  if (!normalize(query)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const label = textOf(it);
    if (!label) continue;
    const key = label.toLowerCase();
    if (!seen.has(key) && smartMatch(query, label)) {
      seen.add(key);
      out.push(label);
      if (out.length >= limit) break;
    }
  }
  return out;
}
