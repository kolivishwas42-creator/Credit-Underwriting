/**
 * Plain words for the bank summary (owner 2026-11-12: "0 checks need a person" read badly).
 * The written summary comes from the model, which does not always skip a zero; these rules make every point read
 * plainly before it is shown. Phrases only -- no numbers are changed.
 */

/** A clause with a zero count is dropped ("…, and 0 checks need a person"). */
export const ZERO_CLAUSE = /(?:,\s*|\s+)(?:and\s+)?0\s+checks?\s+(?:found a problem|needs? a person|needs? (?:a )?(?:manual )?review|failed)/gi;

/** Wording replaced by plainer words, applied in order. */
export const PLAIN_WORDS: [RegExp, string][] = [
  [/\b(\d+) check\(s\)/gi, "$1 checks"],
  [/\b1 checks\b/gi, "1 check"],
  [/\bneed a person to check\b/gi, "need a manual review"],
  [/\bneeds a person\b/gi, "needs a manual review"],
  [/\bneed a person\b/gi, "need a manual review"],
  [/\b1 check need a manual review\b/gi, "1 check needs a manual review"],
];
