import { AgentTitle, SidebarToggle } from "../../shared/components";
// Dedupe Agent -- three jobs: Check an existing case (the screen it opens on), New application (open a case, then run
// dedupe + loan history; needs /api/v1/fos/*, which not every backend serves), and the Dedupe & loan history result
// (the console's common result layout). Everything shown comes from the backend (core viewResult); nothing sensitive
// is logged and every backend value is rendered as text.
import { useCallback, useEffect, useRef, useState } from "react";
import * as C from "./core";
import AllResult from "./components/AllResult";
import ApplyForm from "./components/ApplyForm";
import { ConfirmDialog, SignInDialog } from "./components/Dialogs";
import { Icon, label } from "./components/kit";
import LookupForm, { type LookupHandle } from "./components/LookupForm";
import Result from "./components/Result";
import { api, lastCase, loadSampleConfig, loadUiText, login, onSignIn, rememberCase } from "./services/api";
import { useTheme } from "./theme";
import type { AllView, DedupeRequest, DedupeView, Entered, FormSchema, FormState, SampleConfig, UiText } from "./types";
import { useAgentLoader } from "../../shared/components";

const STAGES = ["FOS", "CPA", "CREDIT", "RCU", "BOPS", "HOPS", "DISBURSEMENT"];   // app/config/stage_lifecycle.yaml
const STAGE_LABEL: Record<string, string> = { FOS: "Sourcing", CPA: "CPA", CREDIT: "Credit", RCU: "RCU", BOPS: "BOPS", HOPS: "HOPS", DISBURSEMENT: "Disbursement" };
type Page = "apply" | "lookup" | "result";
const CRUMB: Record<Page, string> = { apply: "New application", lookup: "Check an existing case", result: "Dedupe & loan history" };

interface Toast { id: number; text: string; tone?: string }
interface ResultError { title: string; message?: string; ref?: string | null; retry?: boolean }
type ApiErr = Error & { status?: number; code?: string; requestId?: string | null; fields?: Record<string, unknown> | null };

/** A yes / no checkbox starts as "false" (sent as false), as the old page did when it drew the box. */
function withBooleanDefaults(form: FormState, schema: FormSchema | null): FormState {
  let next = form;
  for (const raw of schema?.fields || []) {
    const r = (C.effectiveField(raw, next.values).rules || {}) as Record<string, unknown>;
    if (r.boolean && r.control !== "yes_no" && next.values[raw.name] === undefined) next = C.setValue(next, raw.name, "false");
  }
  return next;
}

export default function App() {
  const { toggle } = useTheme();
  const [text, setText] = useState<UiText>({} as UiText);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [formLoad, setFormLoad] = useState<{ state: "loading" | "ok" | "error"; message?: string }>({ state: "loading" });
  const [conn, setConn] = useState<{ state: string; text: string }>({ state: "", text: "Connecting…" });
  const [who, setWho] = useState("");
  const [page, setPage] = useState<Page>("lookup");     // New application needs /api/v1/fos/*: open on the lookup
  const [resultEnabled, setResultEnabled] = useState(false);
  const [form, setForm] = useState<FormState>(C.initialState());
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [summary, setSummary] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useAgentLoader(loading, "run");
  const [resultError, setResultError] = useState<ResultError | null>(null);
  const [view, setView] = useState<DedupeView | null>(null);
  const [allView, setAllView] = useState<AllView | null>(null);
  const [showing, setShowing] = useState<"view" | "all" | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sampleCfg, setSampleCfg] = useState<SampleConfig | null>(null);
  const [confirmRows, setConfirmRows] = useState<[string, string][] | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [focusInvalid, setFocusInvalid] = useState(0);

  const submission = useRef<ReturnType<typeof C.caseSubmission> | null>(null);
  const lastDedupe = useRef<DedupeRequest | null>(null);
  const controller = useRef<AbortController | null>(null);
  const viewRef = useRef<DedupeView | null>(null);
  const confirmResolve = useRef<((ok: boolean) => void) | null>(null);
  const signInResolve = useRef<((ok: boolean) => void) | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const lookupRef = useRef<LookupHandle>(null);
  const origin = useRef<Page>("lookup");                            // the form the last check came from
  const textRef = useRef<UiText>(text);
  textRef.current = text;
  viewRef.current = view;

  const toast = useCallback((t: string, tone?: string) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { id, text: t, tone }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 5200);
  }, []);

  const go = useCallback((p: Page) => {
    setPage(p);
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // ---- sign-in: a 401 anywhere opens the dialog; the call is retried once signed in
  useEffect(() => {
    onSignIn(() => new Promise<boolean>((resolve) => { signInResolve.current = resolve; setSignInOpen(true); }));
    return () => onSignIn(null);
  }, []);
  const endSignIn = (ok: boolean) => { setSignInOpen(false); signInResolve.current?.(ok); signInResolve.current = null; };

  // ---- boot: officer-facing words (optional), then the form schema
  useEffect(() => {
    let alive = true;
    (async () => {
      const words = await loadUiText();
      const t = words || ({} as UiText);
      if (alive && words) setText(t);
      try {
        const { data } = await api("/api/v1/fos/form-schema", { retries: 2, timeoutMs: 15000 });
        const d = data as { fields?: unknown } | null;
        if (!d || !Array.isArray(d.fields)) throw new C.ApiError(0, "MALFORMED_RESPONSE", "The form definition could not be read.");
        const s = C.formSchema(d as FormSchema, t) as FormSchema;     // only the fields the LOS Sourcing screen shows
        if (!alive) return;
        setSchema(s);
        setForm((f) => withBooleanDefaults(f, s));
        setFormLoad({ state: "ok" });
        setConn({ state: "ok", text: "Backend connected" });
        const cfg = await loadSampleConfig();                        // no config: no Fill sample buttons
        if (alive && cfg && cfg.names && cfg.products) setSampleCfg(cfg);
      } catch (err) {
        if (!alive) return;
        setFormLoad({ state: "error", message: (err as Error).message });
        // a backend without the Sourcing endpoints still runs Check an existing case: say what is missing, not "down"
        setConn((err as ApiErr).status === 404 ? { state: "", text: "New application not available" } : { state: "bad", text: "Backend unreachable" });
      }
    })();
    return () => { alive = false; };
  }, []);

  // ---- the form
  const edit = (next: FormState, clear: string[] = []) => {
    setForm(next);
    submission.current = null;                                      // edited: a new logical request, a new key
    if (clear.length) setErrors((e) => { const n = { ...e }; clear.forEach((k) => { n[k] = null; }); return n; });
  };
  const resetForm = () => {
    setForm(withBooleanDefaults(C.initialState(), schema));
    submission.current = null;
    setErrors({});
    setSummary("");
  };
  const fillSample = () => {
    if (!sampleCfg || !schema) return;
    let s: ReturnType<typeof C.generateSample>;
    try { s = C.generateSample(sampleCfg, schema); } catch { toast("The sample config could not be read.", "bad"); return; }
    setForm(withBooleanDefaults(C.applySample(s, schema), schema));
    submission.current = null;
    setErrors({});
    setSummary("");
    toast(`Sample filled: ${s.label}. Click again for another.`);
  };
  const fillLookupSample = () => {
    if (!sampleCfg) return;
    const s = C.lookupSample(sampleCfg, caseId || lastCase());
    lookupRef.current?.fill(s);
    toast(s.caseId ? `Sample filled for case ${s.caseId}. Click again for another.`
      : "Sample filled. Open a case on New application first: its case ID is used here.");
  };

  useEffect(() => {
    if (!focusInvalid) return;
    const first = document.querySelector<HTMLElement>(".field.invalid input, .field.invalid select")
      || document.getElementById(errors.customerType ? "customer-type" : errors.dedupeParameter ? "dedupe-parameter" : "dedupe-value");
    if (first) first.focus();
  }, [focusInvalid]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the check: POST /api/v1/credit/dedupe (or /all), then the model's reason after the page shows
  const loadReason = useCallback(async (v: DedupeView) => {
    if (!v.explanation.pending || !/^ddp_[0-9a-f]{32}$/.test(v.requestId || "")) return;
    let answer: unknown = null;
    try {
      ({ data: answer } = await api(`/api/v1/credit/dedupe/${v.requestId}/reason`, { timeoutMs: 60000 }));
    } catch {
      answer = null;                                                // the deterministic points stay
    }
    const now = viewRef.current;
    if (!now || now.requestId !== v.requestId) return;              // a newer check: leave the page as is
    setView(C.applyReason(now, answer as Parameters<typeof C.applyReason>[1]) as DedupeView);
  }, []);

  const runDedupe = useCallback(async () => {
    const body = lastDedupe.current;
    if (!body) {
      setResultError({ title: "No identifier to check", message: "The applicant has no mobile to check against existing records." });
      setShowing(null);
      return;
    }
    go("result");
    setResultEnabled(true);
    setShowing(null);
    setResultError(null);
    setLoading(true);
    if (controller.current) controller.current.abort();
    controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      if (body.mode === "ALL") {
        // EVERY PARAMETER AT ONCE: one call, one combined screen (each row opens its own detailed view)
        const { mode: _mode, ...rest } = body;
        void _mode;
        const { data } = await api("/api/v1/credit/dedupe/all", { method: "POST", body: rest, timeoutMs: 120000, signal });
        setAllView(C.allView(data as Parameters<typeof C.allView>[0], textRef.current) as AllView);
        setView(null);
        setShowing("all");
        return;
      }
      setAllView(null);
      const { data } = await api("/api/v1/credit/dedupe", { method: "POST", body, timeoutMs: 45000, signal });
      const v = C.viewResult(data as Parameters<typeof C.viewResult>[0], textRef.current) as DedupeView;
      viewRef.current = v;
      setView(v);
      setShowing("view");
      setStage(v.stage || null);
      void loadReason(v);
    } catch (e) {
      const err = e as ApiErr;
      if (err.code === "CANCELLED") return;
      setResultError({ title: err.code === "MALFORMED_RESPONSE" ? "The answer could not be read" : "The check could not run",
        message: err.message, ref: err.requestId, retry: err.status !== 403 && err.status !== 422 });
      setShowing(null);
    } finally {
      setLoading(false);
    }
  }, [go, loadReason]);

  const decide = async (decision: string, candidate: unknown) => {
    if (!lastDedupe.current || !candidate) return;
    const plain = { ...lastDedupe.current };
    lastDedupe.current = { ...plain, confirm_match: decision, candidate };
    try {
      await runDedupe();
      toast(decision === "SAME_CUSTOMER" ? "Recorded: same customer." : "Recorded: different person.");
    } finally {
      lastDedupe.current = plain;                                   // a retry never records the decision twice
    }
  };

  // ---- submit: validate -> confirm -> open case (idempotent) -> dedupe
  const askConfirm = (rows: [string, string][]) => new Promise<boolean>((resolve) => { confirmResolve.current = resolve; setConfirmRows(rows); });
  const answerConfirm = (ok: boolean) => { setConfirmRows(null); confirmResolve.current?.(ok); confirmResolve.current = null; };

  const onSubmit = async () => {
    if (!schema) return;
    const found = C.validate(form, schema) as Record<string, string>;
    setErrors(found);
    const count = Object.keys(found).length;
    setSummary(count ? `${count} field${count > 1 ? "s need" : " needs"} attention.` : "");
    if (count) { setFocusInvalid((n) => n + 1); return; }
    const body = C.createBody(form, schema);
    const rows = ([["Customer", form.customerType], ["Applicant", String(body.applicant.full_name ?? "")],
      ["Product", label(body.application.product)], ["Amount", C.money(body.application.loan_amount)],
      form.customerType === "Existing" ? ["Dedupe by", form.dedupeParameter] : null,
      (body.co_applicants || []).length ? ["Co-applicants", (body.co_applicants || []).map((c) => c.full_name).join(", ")] : null]
      .filter(Boolean)) as [string, string][];
    if (!(await askConfirm(rows))) return;
    setSubmitBusy(true);
    try {
      submission.current = C.caseSubmission(submission.current, body);
      const { data, headers } = await api("/api/v1/fos/applicants", { method: "POST", body: submission.current.body,
        headers: { "Idempotency-Key": submission.current.key }, retries: 2, timeoutMs: 30000 });
      const id = (data as { case_id: string }).case_id;
      setCaseId(id);
      rememberCase(id);
      toast(headers.get("Idempotent-Replayed") === "true" ? `Case ${id} was already open.` : `Case ${id} opened.`);
      setStage(null);
      origin.current = "apply";
      lastDedupe.current = C.dedupeBody(id, form, schema) as DedupeRequest | null;
      await runDedupe();
    } catch (e) {
      const err = e as ApiErr;
      const fields = (err.fields && typeof err.fields === "object" ? err.fields : {}) as Record<string, unknown>;
      if (Object.keys(fields).length) setErrors((x) => ({ ...x, ...Object.fromEntries(Object.entries(fields).map(([k, m]) => [k, String(m)])) }));
      // a field the form does not show (e.g. one the form schema does not expose) is still named, never lost
      const onForm = new Set((schema.fields || []).map((f) => f.name));
      const offForm = Object.entries(fields).filter(([name]) => !onForm.has(name)).map(([name, m]) => `${C.humanise(name)}: ${m}`);
      setSummary([err.message, ...offForm].join(" "));
      toast(err.code === "IDEMPOTENCY_KEY_REUSED" ? "This form changed after an earlier attempt; submit again." : err.message, "bad");
      if (err.code === "IDEMPOTENCY_KEY_REUSED") submission.current = null;
    } finally {
      setSubmitBusy(false);
    }
  };

  const runLookup = async (body: DedupeRequest) => {
    setCaseId(body.case_id);
    origin.current = "lookup";
    lastDedupe.current = body;
    setLookupBusy(true);
    try { await runDedupe(); } finally { setLookupBusy(false); }
  };

  /** What the officer entered for this check: the searched identifier, name and DOB (this page's own input). */
  const entered = (): Entered => {
    const d = (lastDedupe.current || {}) as { dedupe_parameter_value?: string };
    const vals = form.values || {};
    return { value: d.dedupe_parameter_value || form.dedupeValue || null, name: (vals.full_name as string) || null,
      dob: vals.date_of_birth ? String(vals.date_of_birth).split("-").reverse().join("-") : null };
  };

  // ---- the stepper and the top chips
  const chipStage = stage || (caseId ? "FOS" : null);
  const current = STAGES.indexOf(chipStage || "FOS");

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell">
        <nav className="nav" aria-label="Main">
          <div className="brand">
            <span><b><AgentTitle id="dedupe" /></b><small>Dedupe &amp; loan history</small></span>
          </div>
          <ul className="nav-list">
            {([["lookup", <svg key="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>],
              ["apply", <svg key="i" viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z M14 4v5h5 M8 13h8 M8 17h5" /></svg>],
              ["result", <svg key="i" viewBox="0 0 24 24"><path d="M4 19V9 M10 19V5 M16 19v-7 M22 19H2" /></svg>]] as const).map(([p, svg]) => (
              <li key={p}><button className={`nav-item${page === p ? " is-active" : ""}`} data-page={p} id={p === "result" ? "nav-result" : undefined}
                aria-current={page === p ? "page" : undefined} onClick={() => go(p)}>
                {svg}{p === "result" ? "Dedupe & loan history" : CRUMB[p]}</button></li>
            ))}
          </ul>
          <div className="nav-foot">
            <div className={`conn ${conn.state}`.trim()} id="conn" role="status"><span className="dot" /><span id="conn-text">{conn.text}</span></div>
            <div className="who" id="who" hidden={!who}><span className="avatar" aria-hidden="true">•</span><span id="who-text">{who}</span></div>
            <button className="ghost theme-toggle" id="theme" type="button" aria-label="Switch light / dark" onClick={toggle}>
              <svg viewBox="0 0 24 24"><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" /></svg><span>Theme</span></button>
          </div>
        </nav>
        <SidebarToggle />

        <div className="main-wrap">
          <header className="topbar">
            <div className="crumbs"><span id="crumb-page">{CRUMB[page]}</span></div>
            <div className="top-chips">
              <span className="chip" id="chip-case" hidden={!caseId}>{caseId ? `Case ${caseId}` : ""}</span>
              <span className="chip" id="chip-stage" hidden={!chipStage}>{chipStage ? `Stage · ${STAGE_LABEL[chipStage] || chipStage}` : ""}</span>
            </div>
          </header>
          <ol className="stepper" id="stepper" aria-label="LOS workflow stage">
            {STAGES.map((s, i) => (
              <li key={s} className={i < current ? "done" : i === current ? "current" : ""} aria-current={i === current ? "step" : undefined}>
                <span className="n">{i < current ? "✓" : String(i + 1)}</span>{STAGE_LABEL[s]}</li>
            ))}
          </ol>

          <main id="main" tabIndex={-1} ref={mainRef}>
            <section className={`page${page === "apply" ? " is-active" : ""}`} data-page="apply" aria-labelledby="h-apply">
              <div className="page-head">
                <div>
                  <h1 id="h-apply">New application</h1>
                  <p className="lead">Capture the applicant and the loan, then open the case. The existing-customer check
                    (dedupe and loan history) runs as soon as the case is open.</p>
                </div>
                <button type="button" className="btn ghost small sample-btn" id="sample-fill" hidden={!sampleCfg} onClick={fillSample}
                  title="Fill every field with a new random synthetic applicant"><svg viewBox="0 0 24 24"><path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.7z" /></svg>Fill sample</button>
              </div>
              {formLoad.state === "loading" ? (
                <div className="skeleton-form" id="form-loading" aria-busy="true">
                  <div className="sk-card" /><div className="sk-card" /><div className="sk-card tall" />
                </div>
              ) : null}
              {formLoad.state === "error" ? (
                <div className="state-box" id="form-error"><Icon name="bad" className="ico ico-bad" /><div>
                  <h3>The form could not be loaded</h3><p>{formLoad.message}</p>
                  <div className="actions"><button className="btn primary small" type="button" onClick={() => window.location.reload()}>Try again</button></div>
                </div></div>
              ) : null}
              {formLoad.state === "ok" && schema ? (
                <ApplyForm schema={schema} text={text} form={form} errors={errors} summary={summary} busy={submitBusy}
                  onChange={edit} onError={(n, m) => setErrors((e) => ({ ...e, [n]: m }))} onSubmit={onSubmit} onReset={resetForm} />
              ) : null}
            </section>

            <section className={`page${page === "lookup" ? " is-active" : ""}`} data-page="lookup" aria-labelledby="h-lookup">
              <LookupForm ref={lookupRef} busy={lookupBusy} showSample={Boolean(sampleCfg)} onSample={fillLookupSample} onRun={runLookup} />
            </section>

            <section className={`page${page === "result" ? " is-active" : ""}`} data-page="result" aria-label="Dedupe &amp; loan history">
              {loading ? (
                <div id="result-loading" className="result-skeleton" aria-busy="true">
                  <div className="sk-hero" /><div className="sk-row"><div /><div /><div /><div /></div><div className="sk-table" />
                </div>
              ) : null}
              {resultError ? (
                <div className="state-box" id="result-error"><Icon name="bad" className="ico ico-bad" /><div>
                  <h3>{resultError.title}</h3><p>{resultError.message || ""}</p>
                  {resultError.ref ? <p className="ref">{`Reference: ${resultError.ref}`}</p> : null}
                  <div className="actions">
                    {resultError.retry ? <button className="btn primary small" type="button" onClick={() => void runDedupe()}>Retry check</button> : null}
                    <button className="btn ghost small" type="button" onClick={() => go(origin.current)}>Back to the form</button>
                  </div>
                </div></div>
              ) : null}
              {!loading && !resultError && !resultEnabled ? (
                <div className="state-box" id="result-empty"><Icon name="info" className="ico" /><div>
                  <h3>No check run yet</h3>
                  <p>Dedupe and loan history show here once a case is checked.</p>
                  <div className="actions">
                    <button className="btn primary small" type="button" onClick={() => go("lookup")}>Check a case</button>
                    <button className="btn ghost small" type="button" onClick={() => go("apply")}>Start a new application</button>
                  </div>
                </div></div>
              ) : null}
              {!loading && showing === "view" && view ? (
                <Result v={view} text={text} entered={entered()} showBackToAll={Boolean(allView)}
                  onBackToAll={() => setShowing("all")} onDecide={decide} onRerun={() => void runDedupe()} />
              ) : null}
              {!loading && showing === "all" && allView ? (
                <AllResult a={allView} text={text} entered={entered()} onDetails={(v) => { setView(v); setShowing("view"); }}
                  onRerun={() => void runDedupe()} />
              ) : null}
            </section>
          </main>
        </div>
      </div>

      <ConfirmDialog rows={confirmRows} onAnswer={answerConfirm} />
      <SignInDialog open={signInOpen} onCancel={() => endSignIn(false)} onSignIn={async (user, password) => {
        try {
          await login(user, password);
          if (user) setWho(user);
          endSignIn(true);
          return null;
        } catch (e) {
          const err = e as ApiErr;
          return err.status === 404 ? "Sign-in is not available on this backend." : err.message;
        }
      }} />
      <div className="toasts" id="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone || ""}`} role={t.tone === "bad" ? "alert" : "status"}>{t.text}</div>)}
      </div>
    </>
  );
}
