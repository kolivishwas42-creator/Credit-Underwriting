// The two modal dialogs (native <dialog>, as before): "Open this case?" and "Sign in". Esc closes either (= cancel).
import { useEffect, useRef, useState, type ReactNode } from "react";

function Modal({ open, id, labelledBy, onCancel, children }:
  { open: boolean; id: string; labelledBy: string; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); }
    if (!open && d.open) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
  }, [open]);
  return (
    <dialog ref={ref} id={id} aria-labelledby={labelledBy} onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      {children}
    </dialog>
  );
}

/** "Open this case?": the applicant, product, amount (and dedupe parameter / co-applicants) before the case is created. */
export function ConfirmDialog({ rows, onAnswer }: { rows: [string, string][] | null; onAnswer: (ok: boolean) => void }) {
  return (
    <Modal open={Boolean(rows)} id="confirm" labelledBy="confirm-title" onCancel={() => onAnswer(false)}>
      <form className="dlg" onSubmit={(e) => { e.preventDefault(); onAnswer(true); }}>
        <h2 id="confirm-title">Open this case?</h2>
        <p id="confirm-text">A case will be created for this applicant.</p>
        <dl className="confirm-list" id="confirm-list">
          {(rows || []).flatMap(([k, v], i) => [<dt key={`k${i}`}>{k}</dt>, <dd key={`v${i}`}>{v || "—"}</dd>])}
        </dl>
        <div className="dlg-actions"><button type="button" className="btn ghost" onClick={() => onAnswer(false)}>Go back</button>
          <button type="submit" className="btn primary" id="confirm-ok">Open case</button></div>
      </form>
    </Modal>
  );
}

/** Sign in: only where the backend runs its identity provider (POST /api/v1/auth/login). */
export function SignInDialog({ open, onSignIn, onCancel }:
  { open: boolean; onSignIn: (user: string, password: string) => Promise<string | null>; onCancel: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (open) setError(""); }, [open]);
  return (
    <Modal open={open} id="signin" labelledBy="signin-title" onCancel={onCancel}>
      <form className="dlg" id="signin-form" onSubmit={async (e) => {
        e.preventDefault();
        const err = await onSignIn(user.trim(), pass);
        if (err) setError(err); else setPass("");
      }}>
        <h2 id="signin-title">Sign in</h2>
        <p>Your session has ended or the backend needs you to sign in.</p>
        <div className="field"><label htmlFor="si-user">Username</label><input id="si-user" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} /></div>
        <div className="field"><label htmlFor="si-pass">Password</label><input id="si-pass" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
        <p className="field-error" id="si-error" role="alert">{error}</p>
        <div className="dlg-actions"><button type="button" className="btn ghost" id="si-cancel" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary">Sign in</button></div>
      </form>
    </Modal>
  );
}
