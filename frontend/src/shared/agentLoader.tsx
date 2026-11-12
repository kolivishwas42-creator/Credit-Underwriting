import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

/** What an agent is busy with: opening a screen, fetching a case, running its check, saving a decision. */
export type LoaderTopic = "open" | "fetch" | "run" | "save";

type Report = (id: string, topic: LoaderTopic | null) => void;
const Ctx = createContext<Report>(() => { /* outside the console: no overlay */ });

/**
 * Inside an agent screen: `useAgentLoader(busy, "run")`. While `busy` is true the console covers that agent's area
 * with the common loader (Legal's: turning arcs, sparks, the agent's emblem, its own lines for the topic).
 * Outside the console (tests, a screen on its own) it does nothing.
 */
export function useAgentLoader(busy: boolean, topic: LoaderTopic = "run"): void {
  const report = useContext(Ctx);
  const id = useId();
  useEffect(() => {
    report(id, busy ? topic : null);
    return () => report(id, null);
  }, [report, id, busy, topic]);
}

/** Held by AgentHost: which topic (if any) the open agent is busy with now — the latest one wins. */
export function AgentLoaderProvider({ children, render }: {
  children: ReactNode;
  render: (topic: LoaderTopic | null) => ReactNode;
}) {
  const [busy, setBusy] = useState<[string, LoaderTopic][]>([]);
  const report = useMemo<Report>(() => (id, topic) => {
    setBusy((list) => {
      const rest = list.filter(([k]) => k !== id);
      return topic ? [...rest, [id, topic]] : rest.length === list.length ? list : rest;
    });
  }, []);
  const current = busy.length ? busy[busy.length - 1][1] : null;
  return <Ctx.Provider value={report}>{children}{render(current)}</Ctx.Provider>;
}
