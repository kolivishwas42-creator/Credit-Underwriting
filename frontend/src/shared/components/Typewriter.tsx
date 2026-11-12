import { useEffect, useState } from "react";
import { agentById } from "../../config/agents";
import { TYPEWRITER } from "../../config/result";
import { Icon } from "./Icon";

const STILL_IN_TESTS = import.meta.env.MODE === "test";

/**
 * Text that types itself, pauses, erases and types again: Legal's brand title, common to every agent (owner
 * 2026-11-12). The whole text is always the accessible name; the full width is reserved, so nothing next to it moves;
 * with reduced motion (and in tests) it simply shows.
 */
export function Typewriter({ text, className }: { text: string; className?: string }) {
  const [n, setN] = useState(0);
  const [erasing, setErasing] = useState(false);
  const still = STILL_IN_TESTS
    || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (still || !text) return;
    const full = n >= text.length;
    const delay = erasing ? TYPEWRITER.erase_ms : full ? TYPEWRITER.hold_ms : n === 0 ? TYPEWRITER.rest_ms : TYPEWRITER.type_ms;
    const timer = window.setTimeout(() => {
      if (!erasing && full) setErasing(true);
      else if (erasing && n === 0) setErasing(false);
      else setN((x) => x + (erasing ? -1 : 1));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [n, erasing, text, still]);
  if (still) return <span className={`cu-tw is-still ${className ?? ""}`} aria-label={text}>{text}</span>;
  return (
    <span className={`cu-tw ${className ?? ""}`} aria-label={text} role="text">
      <span className="cu-tw-ghost" aria-hidden="true">{text}</span>
      <span className="cu-tw-typed" aria-hidden="true">{text.slice(0, n)}<span className="cu-tw-caret" /></span>
    </span>
  );
}

/** An agent's logo (its icon from the console's agent list, on a sapphire tile) with its full name typing beside it. */
export function AgentTitle({ id, className, logo = true }: { id: string; className?: string; logo?: boolean }) {
  const agent = agentById(id);
  return (
    <span className={`cu-agent-title ${className ?? ""}`}>
      {logo && agent && <span className="cu-agent-logo" aria-hidden="true"><Icon name={agent.icon} /></span>}
      <Typewriter text={agent?.title ?? agent?.label ?? id} />
    </span>
  );
}
