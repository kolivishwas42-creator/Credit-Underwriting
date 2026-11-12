import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * FORM, THEN ITS RESULT ON ITS OWN SCREEN (owner 2026-11-11): once a run answers, the form is put away and the result
 * opens alone, with a bar back to the form. The form stays mounted (only hidden), so nothing typed is lost.
 *
 *   const screen = useResultScreen(result);
 *   <FormArea hidden={screen.onResult}>…form…</FormArea>
 *   {screen.onResult && <BackToForm onBack={screen.back} note="LOS-0001" />}
 *   {screen.onResult && <ResultPage … />}
 */
export function useResultScreen(result: unknown) {
  const [editing, setEditing] = useState(false);
  // a new result opens its screen again, at the top
  useEffect(() => {
    setEditing(false);
    if (result && typeof window !== "undefined") {
      window.setTimeout(() => document.querySelector(".agent-root")?.scrollIntoView?.({ block: "start" }), 0);
    }
  }, [result]);
  return { onResult: Boolean(result) && !editing, back: () => setEditing(true), show: () => setEditing(false), editing,
    hasResult: Boolean(result) };
}

/** The form's wrapper: hidden while the result has the screen. */
export function FormArea({ hidden, children, className }: { hidden: boolean; children: ReactNode; className?: string }) {
  const style: CSSProperties | undefined = hidden ? { display: "none" } : undefined;
  return <div className={className} hidden={hidden} style={style} data-form-area="">{children}</div>;
}

/** The bar over a result: back to the form, and what was run. */
export function BackToForm({ onBack, note, label = "Back to the form" }: { onBack: () => void; note?: ReactNode; label?: string }) {
  return (
    <div className="cu-ui cu-backbar" role="navigation" aria-label="Result screen">
      <button type="button" className="cu-backbar-btn" onClick={onBack}>
        <Icon name="arrow" />{label}
      </button>
      {note && <span className="cu-backbar-note">{note}</span>}
    </div>
  );
}
