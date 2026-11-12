/**
 * Words the common result layout uses on EVERY agent (owner 2026-11-11). Change them here, not in the components.
 */

/** One decision vocabulary across the console, by the result's tone; the agent's own word shows under it. */
export const DECISION_WORDS: Record<"pass" | "review" | "fail" | "info" | "na", string> = {
  pass: "Positive",
  review: "Refer",
  fail: "Negative",
  info: "Pending",
  na: "Pending",
};

/** Words too common to tie an AI summary point to a rule ("…matches the PAN" ↔ rule "Applicant name matches the PAN"). */
export const LINK_STOP_WORDS = [
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "has", "have", "not", "but", "all", "any",
  "match", "matches", "matched", "matching", "check", "checks", "checked", "rule", "rules", "within", "across",
  "verification", "verified", "details", "detail", "case", "found", "there", "their", "into", "than", "same",
];

/** A point is tied to a rule when at least this share of the rule name's words appear in it (and at least 2 words). */
export const LINK_MIN_SHARE = 0.5;
export const LINK_MIN_WORDS = 2;

/** Log-in names of a development / demo session (AUTH off): never shown on a screen (owner 2026-11-11); a real
 *  officer's name (AUTH on) is shown as it comes. */
export const HIDDEN_PEOPLE = ["local-developer", "local_developer", "local developer", "local-dev", "dev-user", "anonymous"];
/** What a screen says instead of a hidden name. */
export const HIDDEN_PERSON_LABEL = "Officer";

/** A rule whose values hold one of these pairs shows them on its card, side by side (no "Show values" needed). */
export const COMPARE_PAIRS: [string, string][] = [
  ["Value", "Limit"],
  ["Application", "Vendor report"],
  ["Application", "Agency report"],
  ["Application", "Document"],
  ["Vendor selected", "Read as"],
];
/** Plainer words for those labels on the card. */
/** a limit can be a floor (income, score) or a ceiling (FOIR, LTV): "Policy limit" is right for both */
export const COMPARE_WORDS: Record<string, string> = { Value: "Actual", Limit: "Policy limit", "Read as": "Found in the ITR" };

/** A summary point that starts with one of these is the NEXT STEP: shown as its own line under the points. */
export const NEXT_STEP_STARTS = ["next step", "next action", "recommended action", "proceed with", "proceed to", "action:"];

/** "Key numbers" under the AI summary: at most this many, values no longer than this. */
export const KEY_NUMBERS_MAX = 4;
export const KEY_NUMBER_MAX_CHARS = 22;

/** STRENGTHS (owner 2026-11-12: "strength me jo dikha rahe ho, woh useful hona chahiye"): a passed rule shows with
 *  its proof -- the numbers it compared, else its reason line. Proof with numbers first, at most this many; a pass
 *  with no proof (only "Passed") is counted under "more checks passed", not listed as a strength. */
export const STRENGTHS_SHOWN = 4;
/** A reason line that says nothing beyond the outcome itself (compared lower-case, trimmed, without the full stop).
 *  Used by Strengths and by Concerns (owner 2026-11-12: "concerns me bhi aisa hi proof dikhao"). */
export const ROUTINE_DETAIL = ["pass", "passed", "ok", "okay", "yes", "true", "matched", "match", "verified", "valid",
  "clear", "no issues", "no issue", "nothing found", "not applicable", "n/a", "na", "-", "—", "within limit",
  "fail", "failed", "no", "false", "not matched", "mismatch", "review", "review required", "refer", "needs review"];
/** The line under the strengths for the passes not listed. */
export const MORE_PASSED = (n: number) => `+${n} more ${n === 1 ? "check" : "checks"} passed`;

/** Field names that reach a summary point ("acknowledgement_number") read as words; these stay in capitals. */
export const UPPER_WORDS = ["pan", "gti", "itr", "emi", "foir", "ltv", "ifsc", "aa", "aml", "pep", "dpd", "cersai", "kyc", "los", "ay", "id"];

/** The agent title that types itself (like Legal's brand title): milliseconds per step. */
export const TYPEWRITER = { type_ms: 95, erase_ms: 45, hold_ms: 2200, rest_ms: 500 };
