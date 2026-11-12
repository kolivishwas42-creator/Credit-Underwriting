import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AGENTS, GROUPS } from "../../config/agents";
import { useBackendStatus, type BackendStatus } from "../hooks/useBackendStatus";
// theme button commented out for every agent (owner 2026-11-12): the theme helpers stay in ../theme
// import { applyTheme, nextTheme, savedTheme, type ThemeChoice } from "../theme";
import { Icon } from "./Icon";
import { Logo } from "./Logo";

interface Props {
  active: string | null;
  onOpen: (id: string | null) => void;
  onSearch: () => void;
}

// const THEME_LABEL: Record<ThemeChoice, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };
// const THEME_ICON: Record<ThemeChoice, string> = { system: "monitor", light: "sun", dark: "moon" };
const STATUS_LABEL: Record<BackendStatus, string> = {
  checking: "Checking…", online: "Backend connected", offline: "Backend offline",
};
const ORDERED = GROUPS.flatMap((g) => AGENTS.filter((a) => a.group === g));
const STEP = 280;

/**
 * The console header: brand, quick search, backend status, theme — and one tab per agent across the top
 * (Overview first, then the agents in journey order, a thin divider between stages). The tab row scrolls
 * sideways with ‹ › when it does not fit; the open tab is always scrolled into view.
 */
export function TopNav({ active, onOpen, onSearch }: Props) {
  // const [theme, setTheme] = useState<ThemeChoice>(savedTheme);
  const status = useBackendStatus();
  const row = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return undefined;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => { el.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); };
  }, [measure]);

  useLayoutEffect(() => {
    const tab = row.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    tab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    measure();
  }, [active, measure]);

  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * STEP, behavior: "smooth" });
  // const cycleTheme = () => { const t = nextTheme(theme); applyTheme(t); setTheme(t); };

  return (
    <div className="cu-top" role="banner">
      <div className="cu-bar">
        <button type="button" className="cu-brand" onClick={() => onOpen(null)} title="Overview of all agents">
          <Logo />
          <span className="cu-brand-text"><b>Credit Underwriting</b><span>Agent console</span></span>
        </button>
        <div className="cu-bar-tools">
          <button type="button" className="cu-find" onClick={onSearch} aria-label="Find an agent (Ctrl+K)">
            <Icon name="search" /><span>Find an agent</span><kbd>Ctrl K</kbd>
          </button>
          <span className={`cu-status is-${status}`} role="status" title={STATUS_LABEL[status]}>
            <i aria-hidden="true" /><span>{STATUS_LABEL[status]}</span>
          </span>
          {/* theme button (system / light / dark) commented out
          <button type="button" className="cu-icon-btn" onClick={cycleTheme} title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}>
            <Icon name={THEME_ICON[theme]} />
          </button>
          */}
        </div>
      </div>

      <div className="cu-tabs" role="navigation" aria-label="Agent tabs">
        <button type="button" className="cu-tabs-arrow" onClick={() => scroll(-1)} disabled={!edge.left}
          aria-label="Scroll tabs left" tabIndex={-1}>
          <Icon name="collapse" />
        </button>
        <div className="cu-tabs-row" ref={row} role="tablist" aria-label="Agents">
          <button type="button" role="tab" aria-selected={active === null}
            className={`cu-tab${active === null ? " is-active" : ""}`} onClick={() => onOpen(null)}>
            <Icon name="grid" /><span>Overview</span>
          </button>
          {ORDERED.map((a, i) => (
            <Fragment key={a.id}>
              {(i === 0 || ORDERED[i - 1].group !== a.group) && <span className="cu-tab-sep" aria-hidden="true" />}
              <button type="button" role="tab" aria-selected={a.id === active} title={a.description}
                className={`cu-tab${a.id === active ? " is-active" : ""}`} onClick={() => onOpen(a.id)}>
                <Icon name={a.icon} /><span>{a.label}</span>
              </button>
            </Fragment>
          ))}
        </div>
        <button type="button" className="cu-tabs-arrow" onClick={() => scroll(1)} disabled={!edge.right}
          aria-label="Scroll tabs right" tabIndex={-1}>
          <Icon name="expand" />
        </button>
      </div>
    </div>
  );
}
