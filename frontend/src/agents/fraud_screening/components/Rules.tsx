import type { RuleConfig } from "../types";
import { Pagination, usePagination } from "../../../shared/components";

/** the rule switches: implementable rules toggle, the others stay disabled; a switch is locked while it saves */
export function RuleConfigTable({ rules, pending, onToggle }: {
  rules: RuleConfig[]; pending: Set<string>; onToggle: (rule: RuleConfig, enabled: boolean) => void;
}) {
  const pager = usePagination(rules);
  return (
    <div className="card tab-pane" id="tab-config">
      <h2>Rule configuration</h2>
      <p className="hint">Toggle rules that are implementable. Non-implementable rules stay disabled.</p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Rule</th><th>Name</th><th>Severity</th><th>Implementable</th><th>Enabled</th></tr></thead>
          <tbody>
            {pager.rows.map((r) => (
              <tr key={r.rule_key} className={r.is_implementable ? "" : "s-disabled"}>
                <td>{r.rule_id}</td>
                <td>{r.rule_name}</td>
                <td>{r.severity}</td>
                <td>{r.is_implementable ? "Yes" : "No"}</td>
                <td>
                  <label className="switch">
                    <input type="checkbox" aria-label={`Enable ${r.rule_name}`} checked={r.enabled}
                           disabled={!r.is_implementable || pending.has(r.rule_key)}
                           onChange={(e) => onToggle(r, e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination pager={pager} noun="rules" />
    </div>
  );
}
