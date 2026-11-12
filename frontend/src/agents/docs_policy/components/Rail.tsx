import { AgentTitle } from "../../../shared/components";
// The rail: brand + theme toggle, the Case ID search, recent cases, the rules by section, the legend.
import type { FormEvent, RefObject } from "react";
import { RULE_TONE } from "../lib/format";
import type { Board, RecentItem } from "../types";
import { MoonIcon, SearchIcon, SunIcon } from "./Icons";

interface Props {
  board: Board | null;
  dark: boolean;
  onToggleTheme: () => void;
  query: string;
  onQuery: (v: string) => void;
  onSearch: () => void;
  loading: boolean;
  error: string | null;
  inputRef: RefObject<HTMLInputElement>;
  recent: RecentItem[];
  onOpenCase: (id: string) => void;
  activeRule: string | null;
  onOpenRule: (id: string) => void;
}

export function Rail(p: Props) {
  const themeTitle = p.dark ? "Switch to light mode" : "Switch to dark mode";
  const submit = (e: FormEvent) => { e.preventDefault(); p.onSearch(); };
  const now = p.board?.case.case_id;
  return (
    <aside className="rail" aria-label="Search and rules">
      <div className="brand">
        <div className="grow"><div className="brand-title"><AgentTitle id="docs_policy" /></div><div className="brand-sub">Readiness for underwriting</div></div>
        <button className="theme-btn" type="button" id="theme-btn" aria-label={themeTitle} title={themeTitle} onClick={p.onToggleTheme}>
          {p.dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      <form className="search" id="search" autoComplete="off" role="search" onSubmit={submit}>
        <label className="search-label" htmlFor="case-input">Case ID</label>
        <div className="search-box">
          <SearchIcon />
          <input id="case-input" name="case" type="text" placeholder="CASE-…" spellCheck={false} aria-label="Case ID"
            ref={p.inputRef} value={p.query} onChange={(e) => p.onQuery(e.target.value)} />
          <kbd>/</kbd>
        </div>
        <button className="btn-brand" type="submit" disabled={p.loading}>{p.loading ? "Checking…" : "Check documents"}</button>
        <p className="search-error" id="search-error" role="alert" hidden={!p.error}>{p.error || ""}</p>
      </form>

      <div className="recent" id="recent" hidden={!p.recent.length}>
        {p.recent.length > 0 && <div className="search-label">Recent</div>}
        {p.recent.map((x) => (
          <button key={x.id} type="button" className={`recent-item ${x.id === now ? "active" : ""}`} data-id={x.id}
            onClick={() => p.onOpenCase(x.id)}>
            <i className={`dot ${x.tone}`}></i><span className="nm">{x.name || x.id}</span><span className="rid">{x.id.slice(-4)}</span>
          </button>
        ))}
      </div>

      <nav className="rules" id="rules" aria-label="Rule checks">
        {p.board && p.board.sections.map((s) => {
          const open = (s.counts.FAIL || 0) + (s.counts.WARN || 0);
          return (
            <div className="rsec" key={s.id}>
              <div className="rsec-head"><h3>{s.name}</h3><span className={`t ${open ? "" : "clear"}`}>{open ? `${open} open` : "✓ clear"}</span></div>
              {s.rules.map((id) => {
                const r = p.board!.rules.find((x) => x.rule_id === id);
                if (!r) return null;
                const tone = RULE_TONE[r.status] || "na";
                const n = r.status === "OFF" ? "off" : r.total ? `${r.passed}/${r.total}` : "—";
                return (
                  <button key={id} className={`rule ${tone} ${id === p.activeRule ? "active" : ""}`} data-id={id} title={r.help}
                    onClick={() => p.onOpenRule(id)}>
                    <i className={`dot ${tone}`}></i><span className="nm">{r.name}</span><span className="n">{n}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="rail-foot" id="rail-foot">
        <span><i className="dot ok"></i>Pass</span><span><i className="dot warn"></i>To collect</span>
        <span><i className="dot bad"></i>Critical</span><span><i className="dot na"></i>N/A</span>
      </div>
    </aside>
  );
}
