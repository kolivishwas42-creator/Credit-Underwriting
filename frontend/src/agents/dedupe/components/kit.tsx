// The page's small building blocks: the static icons (the only markup not built from data), pills and the helpers
// the old app.js shared between panels. Every backend value is rendered as React text -- never as HTML.
import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  ok: <path d="M5 12.5 10 17l9-10" />,
  warn: <path d="M12 4 2.8 20h18.4z M12 10v4.5 M12 17.5h.01" />,
  bad: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v6 M12 16.5h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5 M12 7.5h.01" /></>,
  na: <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>,
  spark: <path d="M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18 M6 18l2.5-2.5 M15.5 8.5 18 6" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></>,
  db: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6 M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>,
  rules: <path d="M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01" />,
  list: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18 M8 14h8" /></>,
  shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />,
};

export type IconName = keyof typeof PATHS | string;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <span className={className || ""} aria-hidden="true">
      <svg viewBox="0 0 24 24">{PATHS[name] ?? PATHS.info}</svg>
    </span>
  );
}

export function Pill({ tone, children }: { tone?: string | null; children: ReactNode }) {
  return <span className={`pill ${tone || "na"}`}>{children}</span>;
}

/** "HOME_LOAN" -> "Home loan" (the old page's `label`). */
export const label = (code: unknown) =>
  String(code || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** The summary as points: split on sentence ends (". " followed by a capital), keeping masked refs like AP******18. */
export function sentences(text: unknown): string[] {
  return String(text).split(/(?<=\.)\s+(?=[A-Z0-9(])/).map((t) => t.trim()).filter(Boolean);
}

export const Dash = ({ title }: { title?: string }) => <span className="dash" title={title}>—</span>;

/** A submit / action button with the old page's busy state (spinner + aria-busy + disabled). */
export function BusyButton({ busy, className, children, ...rest }:
  { busy: boolean; className: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`${className}${busy ? " busy" : ""}`} disabled={busy || rest.disabled} aria-busy={busy ? "true" : "false"}>
      {children}
    </button>
  );
}
