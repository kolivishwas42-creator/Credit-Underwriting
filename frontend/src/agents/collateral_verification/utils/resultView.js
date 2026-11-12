// The collateral verification result in the console's COMMON RESULT LAYOUT (shared/components/result): a pure adapter
// from the POST /collateral/verify response to ResultPageProps. Only what the API returns is shown.
//
// Response: { application_id, application_number, data_source, vendor_final_status, report_file, run_id?,
//             comparison_results: [{ rule_id, label, enabled, status, summary, db_value, vendor_value, detail }],
//             source_evidence: {...},
//             summary: { overall, counts, vendor_final_status, vendor_status_conflict, conflict_reason,
//                        recommended_actions } }

/**
 * Tone of a collateral status (rule or overall):
 *   PASS                    -> pass
 *   REFER                   -> fail   (sent back for manual review: a problem was found)
 *   WARNING / PENDING       -> review (a person has to look / a vendor field is missing)
 *   NOT_APPLICABLE / SKIPPED / anything else -> na
 */
export function toneOf(status) {
  switch (String(status || "").toUpperCase()) {
    case "PASS": return "pass";
    case "REFER": return "fail";
    case "WARNING":
    case "PENDING": return "review";
    default: return "na";
  }
}

/** The agent's own word: "REFER" -> "Refer", "NOT_APPLICABLE" -> "Not applicable". */
export function statusWord(status) {
  const s = String(status || "").replaceAll("_", " ").toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

/** A compared value (string / number / list / object) as one readable line. */
export function valueText(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  if (Array.isArray(value)) return value.length ? value.map(valueText).join("; ") : "Not available";
  if (typeof value === "object") {
    const parts = Object.entries(value)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k.replaceAll("_", " ")}: ${valueText(v)}`);
    return parts.length ? parts.join(" · ") : "Not available";
  }
  return String(value);
}

const ORDER = { REFER: 0, WARNING: 1, PENDING: 2, PASS: 3, NOT_APPLICABLE: 4, SKIPPED: 5 };
const rank = (r) => ORDER[String(r.status || "").toUpperCase()] ?? 4;

/** Every rule line: problems first (Refer, Warning, Pending), then passed, then not applicable / switched off. */
export function toRules(comparisons) {
  return (comparisons || [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => {
      const values = [
        { label: "Application", value: valueText(r.db_value) },
        { label: "Vendor report", value: valueText(r.vendor_value) },
      ];
      // the detailed comparison: a value made of parts (a location ...) is a table, one row a part
      const isParts = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
      let table;
      if (isParts(r.db_value) || isParts(r.vendor_value)) {
        const a = isParts(r.db_value) ? r.db_value : {};
        const v = isParts(r.vendor_value) ? r.vendor_value : {};
        table = {
          columns: ["Field", "Application value", "Vendor value"],
          rows: [...new Set([...Object.keys(a), ...Object.keys(v)])].map((key) => {
            const word = key.replaceAll("_", " ");
            return [word.charAt(0).toUpperCase() + word.slice(1), valueText(a[key]), valueText(v[key])];
          }),
        };
      }
      if (r.summary) values.push({ label: "Result", value: r.summary });
      if (r.detail) values.push({ label: "Note", value: r.detail });
      values.push({ label: "Rule", value: r.rule_id, mono: true });
      return {
        id: r.rule_id,
        name: r.label || r.rule_id,
        outcome: toneOf(r.status),
        outcomeLabel: statusWord(r.status),
        detail: r.summary || undefined,
        values,
        table,
      };
    });
}

const pct = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
};
const fmt = (n) => `${+n.toFixed(2)}`;

/** Numbers compared: rule counts, completion % against the tolerance, the location parts, the vendor status. */
export function toCalculations(result, opts = {}) {
  const rows = [];
  const comparisons = result.comparison_results || [];
  const counts = result.summary?.counts || {};
  for (const [status, n] of Object.entries(counts)) {
    rows.push({ group: "Rule outcomes", label: statusWord(status), value: n, tone: toneOf(status) === "na" ? undefined : toneOf(status) });
  }
  const skipped = comparisons.filter((r) => String(r.status).toUpperCase() === "SKIPPED").length;
  if (skipped) rows.push({ group: "Rule outcomes", label: "Switched off", value: skipped });

  const completion = comparisons.find((r) => String(r.rule_id || "").includes("completion"));
  if (completion && String(completion.status).toUpperCase() !== "SKIPPED") {
    const app = pct(completion.db_value);
    const ven = pct(completion.vendor_value);
    // the rule states the tolerance it used ("... (tolerance 10)." / "Tolerance is 10 percentage points"); else /config
    const said = /tolerance(?: is)? ([\d.]+)/i.exec(`${completion.summary || ""} ${completion.detail || ""}`);
    const tol = said ? Number(said[1]) : pct(opts.tolerancePp);
    rows.push({ group: "Construction completion", label: "Application", value: app === null ? "Not available" : `${fmt(app)}%` });
    rows.push({ group: "Construction completion", label: "Vendor report", value: ven === null ? "Not available" : `${fmt(ven)}%` });
    if (app !== null && ven !== null) {
      rows.push({ group: "Construction completion", label: "Difference", value: `${fmt(Math.abs(app - ven))} pp`,
                  tone: toneOf(completion.status), hint: tol !== null ? `tolerance ${fmt(tol)} pp` : undefined });
    } else if (tol !== null) {
      rows.push({ group: "Construction completion", label: "Tolerance", value: `${fmt(tol)} pp` });
    }
  }

  const location = comparisons.find((r) => String(r.rule_id || "").includes("location"));
  if (location && location.db_value && typeof location.db_value === "object" && location.vendor_value && typeof location.vendor_value === "object") {
    for (const [key, label] of [["pincode", "PIN"], ["city", "City"], ["state", "State"]]) {
      const a = String(location.db_value[key] ?? "").trim();
      const b = String(location.vendor_value[key] ?? "").trim();
      if (!a && !b) continue;
      const same = key === "pincode" ? a === b : a.toLowerCase() === b.toLowerCase();
      rows.push({ group: "Location", label, value: `${a || "—"} / ${b || "—"}`, hint: "application / vendor",
                  tone: !b ? "review" : same ? "pass" : "fail" });
    }
  }

  if (result.vendor_final_status) rows.push({ group: "Vendor", label: "Vendor final status", value: statusWord(result.vendor_final_status) });
  if (result.summary && "vendor_status_conflict" in result.summary) {
    rows.push({ group: "Vendor", label: "Conflict with the rules", value: result.summary.vendor_status_conflict ? "Yes" : "No",
                tone: result.summary.vendor_status_conflict ? "fail" : "pass" });
  }
  return rows;
}

/** The rules engine's written points: the vendor conflict and the recommended actions; else derived from the rules. */
export function toPoints(result) {
  const s = result.summary || {};
  const out = [];
  const add = (p) => { const t = String(p || "").trim(); if (t && !out.includes(t)) out.push(t); };
  if (s.vendor_status_conflict) add(s.conflict_reason);
  (s.recommended_actions || []).forEach(add);
  if (out.length) return out;
  const active = (result.comparison_results || []).filter((r) => String(r.status).toUpperCase() !== "SKIPPED");
  const passed = active.filter((r) => String(r.status).toUpperCase() === "PASS").length;
  if (active.length) add(`${passed} of ${active.length} applicable rules passed.`);
  active.filter((r) => toneOf(r.status) !== "pass" && toneOf(r.status) !== "na").slice(0, 4)
    .forEach((r) => add(`${r.label}: ${r.summary}`));
  return out;
}

export function toResultPage(result, opts = {}) {
  const comparisons = result.comparison_results || [];
  const active = comparisons.filter((r) => String(r.status).toUpperCase() !== "SKIPPED");
  const count = (tone) => active.filter((r) => toneOf(r.status) === tone).length;
  const overall = result.summary?.overall;
  const address = result.source_evidence?.property_address;

  const facts = [];
  if (result.application_number) facts.push({ label: "Application", value: result.application_number, mono: true });
  if (result.application_id !== undefined && result.application_id !== null) facts.push({ label: "Application ID", value: String(result.application_id), mono: true });
  if (result.vendor_final_status) facts.push({ label: "Vendor final status", value: statusWord(result.vendor_final_status) });
  if (result.report_file) facts.push({ label: "Vendor report", value: result.report_file });
  if (typeof address === "string" && address.trim()) facts.push({ label: "Property address", value: address.trim() });

  return {
    basic: {
      eyebrow: "Credit underwriting · Collateral verification",
      title: result.application_number || String(result.application_id ?? "Collateral verification"),
      subtitle: "Vendor visit report compared with the collateral record",
      icon: "home",
      facts,
      decision: overall ? { label: statusWord(overall), tone: toneOf(overall) } : undefined,
      kpis: [
        { label: "Rules run", value: active.length, tone: "info" },
        { label: "Passed", value: count("pass"), tone: "pass" },
        { label: "Pending / warning", value: count("review"), tone: "review" },
        { label: "Refer", value: count("fail"), tone: "fail" },
      ],
    },
    // recommended actions are written by the rules engine (no model): a "Rules summary"
    summary: { title: "Summary", source: "Rules summary", points: toPoints(result), empty: "Every applicable rule passed." },
    rules: { title: "Rules", rules: toRules(comparisons), empty: "No rules were run." },
    calculations: { title: "Calculations", rows: toCalculations(result, opts) },
    // no decision workflow exists in this agent yet: the buttons are presentational
    actions: [
      { id: "missing", label: "Request missing details", kind: "secondary", icon: "send" },
      { id: "refer", label: "Refer for review", kind: "warning", icon: "flag" },
      { id: "approve", label: "Approve collateral", kind: "primary", icon: "check" },
    ],
  };
}
