import { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS, type AgentInfo } from "../../config/agents";
import { Icon } from "./Icon";

export const matches = (a: AgentInfo, q: string): boolean => {
  const s = q.trim().toLowerCase();
  return !s || [a.label, a.description, a.group, a.id.replace(/_/g, " ")].some((t) => t.toLowerCase().includes(s));
};

interface Props { open: boolean; onClose: () => void; onOpen: (id: string) => void }

/** Ctrl+K / ⌘K: type a few letters, Enter opens the agent. */
export function CommandPalette({ open, onClose, onOpen }: Props) {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const found = useMemo(() => AGENTS.filter((a) => matches(a, q)), [q]);

  useEffect(() => { if (open) { setQ(""); setIndex(0); window.setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => { setIndex(0); }, [q]);
  if (!open) return null;

  const choose = (a?: AgentInfo) => { if (a) { onOpen(a.id); onClose(); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, found.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") choose(found[index]);
  };

  return (
    <div className="cu-palette-scrim" onMouseDown={onClose}>
      <div className="cu-palette" role="dialog" aria-modal="true" aria-label="Open an agent"
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="cu-palette-search">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Open an agent…"
            aria-label="Search agents" />
          <kbd>Esc</kbd>
        </div>
        <div className="cu-palette-list" role="listbox" aria-label="Agents">
          {found.map((a, i) => (
            <div key={a.id} role="option" aria-selected={i === index} className={i === index ? "is-on" : ""}
              onMouseEnter={() => setIndex(i)} onClick={() => choose(a)}>
              <Icon name={a.icon} />
              <span className="cu-palette-text"><b>{a.label}</b><span>{a.description}</span></span>
              <span className="cu-palette-group">{a.group}</span>
            </div>
          ))}
          {!found.length && <div className="cu-palette-empty">No agent matches “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}
