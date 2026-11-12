import { useEffect, useId, useState } from "react";
import { Icon } from "./Icon";

interface Props {
  /** first line (and the only one when `lines` is not given) */
  label?: string;
  /** further lines shown in turn, one about every 1.3 s */
  lines?: string[];
  /** the emblem in the middle: an Icon name (the open agent's icon) */
  icon?: string;
  /** small inline version (no minimum height) */
  compact?: boolean;
  /** covers the agent's area (the console places it over the screen while the agent works) */
  overlay?: boolean;
}

/**
 * The console loader — Legal Verification's, for every agent: small and exactly centred, no box. An ink→ember arc
 * that draws itself round while it turns, a thin counter arc, sparks chasing round, and in the middle the agent's
 * emblem on a hexagon seal (the band colours) with a light line scanning it; under it what is being done, one line
 * at a time, with step dots.
 */
export function Loader({ label = "Loading…", lines, icon = "grid", compact = false, overlay = false }: Props) {
  const all = [label, ...(lines ?? [])];
  const [i, setI] = useState(0);
  const gid = `cul${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  useEffect(() => {
    if (all.length < 2) return undefined;
    const timer = window.setInterval(() => setI((x) => Math.min(x + 1, all.length - 1)), 1300);
    return () => window.clearInterval(timer);
  }, [all.length]);

  const body = (
    <div className={`cu-ui cu-center${compact ? " is-compact" : ""}${overlay ? " is-overlay-body" : ""}`}
      role="status" aria-live="polite">
      <span className="cu-load">
        <svg viewBox="0 0 80 80" className="cu-load-svg" aria-hidden="true">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--ie-ink, #18181B)" /><stop offset="100%" stopColor="var(--ie-ember, #1E40AF)" />
            </linearGradient>
          </defs>
          <circle cx="40" cy="40" r="34" className="cu-load-track" />
          <g className="cu-load-turn"><circle cx="40" cy="40" r="34" className="cu-load-arc" stroke={`url(#${gid})`} /></g>
          <g className="cu-load-back"><circle cx="40" cy="40" r="27" className="cu-load-arc2" /></g>
        </svg>
        <span className="cu-load-sparks" aria-hidden="true"><i /><i /><i /></span>
        <span className="cu-load-emblem" aria-hidden="true">
          <svg viewBox="0 0 40 40" className="cu-load-seal">
            <defs>
              <linearGradient id={`${gid}h`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--ie-band, #0F172A)" /><stop offset="100%" stopColor="var(--ie-band-end, #21245E)" />
              </linearGradient>
            </defs>
            <path d="M20 2 L35.6 11 L35.6 29 L20 38 L4.4 29 L4.4 11 Z" fill={`url(#${gid}h)`} />
            <path d="M20 6.5 L31.7 13.25 L31.7 26.75 L20 33.5 L8.3 26.75 L8.3 13.25 Z" className="cu-load-ring" />
          </svg>
          <span className="cu-load-icon"><Icon name={icon} /></span>
          <span className="cu-load-scan" />
        </span>
      </span>
      <span key={i} className="cu-load-text">{all[i]}</span>
      {all.length > 1 && (
        <span className="cu-load-steps" aria-hidden="true">
          {all.map((_, j) => <i key={j} className={j === i ? "on" : j < i ? "done" : ""} />)}
        </span>
      )}
    </div>
  );
  return overlay ? <div className="cu-ui cu-load-overlay">{body}</div> : body;
}
