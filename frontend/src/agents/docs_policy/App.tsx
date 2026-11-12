// Credit Document Desk. Every status comes from the backend; this page decides nothing. The case shows in the console's
// common result layout (utils/resultView): basic card -> brief -> policy rules | document counts -> checklists -> actions.
//   POST /api/v1/credit/document-readiness/{case_id}/rules
//     -> case, answer (summary.route, summary.people), rules + sections, documents (rows x people)
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner } from "./components/Banner";
import { Brief } from "./components/Brief";
import { Drawer, Line, PagedLines, type DrawerContent } from "./components/Drawer";
import { People } from "./components/People";
import { Rail } from "./components/Rail";
import { Toast, useToast } from "./components/Toast";
import { Welcome } from "./components/Welcome";
import { useAgentLoader, ResultPage, SidebarToggle } from "../../shared/components";
import {
  DONE, docLook, normalise, notUploaded, OPEN_WORD, personName, ROLES, ROUTE_TONE, RULE_TONE, RULE_WORD, VALID_CASE_ID, words,
} from "./lib/format";
import { fetchBoard } from "./services/api";
import { toResultPage } from "./utils/resultView";
import { useTheme } from "./theme";
import type { Board, Filter, RecentItem, Role } from "./types";

/** The box the desk's page-state classes go on: the console's agent host (its old <body>), else <body>. */
const pageBox = (): HTMLElement => document.querySelector<HTMLElement>(".agent-host") ?? document.body;


const RECENT_KEY = "docs-credit-recent";

function readRecent(): RecentItem[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as RecentItem[];
    return Array.isArray(list) ? list.filter((x) => x && x.id) : [];
  } catch { return []; }
}

export default function App() {
  const [dark, toggleTheme] = useTheme();
  const [board, setBoard] = useState<Board | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [loading, setLoading] = useState(false);
  useAgentLoader(loading, "run");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>(readRecent);
  const [renderKey, setRenderKey] = useState(0);              // replays the fade-in on every render of the case, as before
  const { toast, toastState } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;

  // the old page's body classes: the CSS shows the welcome or the case, and the load bar, from them
  useEffect(() => { pageBox().classList.toggle("is-empty", !board); }, [board]);
  useEffect(() => { pageBox().classList.toggle("is-loading", loading); }, [loading]);

  const closeDrawer = useCallback(() => { setDrawerOpen(false); setRuleId(null); }, []);

  const fail = useCallback((message: string) => {
    setError(message);
    if (boardRef.current) toast(message);
  }, [toast]);

  const remember = useCallback((b: Board) => {
    const tone = (ROUTE_TONE[b.answer.summary.route.decision] || ["na"])[0];
    const item: RecentItem = { id: b.case.case_id, name: b.case.applicant_name || "", tone };
    const list = [item, ...readRecent().filter((x) => x.id !== item.id)].slice(0, 5);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private window: no list, nothing breaks */ }
    setRecent(list);
  }, []);

  const openCase = useCallback(async (raw: string, { keepFilter = false } = {}) => {
    const caseId = normalise(raw);
    if (!caseId || loadingRef.current) return;
    if (!VALID_CASE_ID.test(caseId)) return fail("A case ID has only letters, numbers, dots, dashes and colons.");
    closeDrawer();
    loadingRef.current = true;
    setLoading(true);
    try {
      const b = await fetchBoard(caseId);
      setBoard(b);
      setCheckedAt(new Date());
      if (!keepFilter) setFilter(null);
      setRenderKey((k) => k + 1);
      setError(null);
      setQuery(caseId);
      window.history.replaceState(null, "", `?case=${encodeURIComponent(caseId)}`);
      document.title = `${b.case.applicant_name || caseId} · Credit Document Desk`;
      remember(b);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [closeDrawer, fail, remember]);

  const showDrawer = (content: DrawerContent) => { setDrawer(content); setDrawerOpen(true); };

  const openDoc = (slot: string, role: Role) => {
    if (!board) return;
    const row = board.documents.rows.find((r) => r.slot === slot);
    const c = row && row.cells[role];
    if (!row || !c) return;
    const [tone, , text] = docLook(c);
    const accepts = (c.accepts || []).map(words).join(", ");
    setRuleId(null);
    showDrawer({
      kicker: `${ROLES[role] || words(role)} · ${personName(board, role) || ""}`, title: row.label,
      help: c.state === "MISSING" ? `Not on file yet.${accepts ? ` Any one of these is accepted: ${accepts}.` : ""}` : "",
      stat: <>
        {c.state === "AWAITING_APPROVAL" ? <span className="tag approval">Approval</span>
          : <span className={`tag ${tone}`}>{tone === "bad" ? "Critical" : tone === "warn" ? "To collect" : "OK"}</span>}
        {` ${text}`}
        {c.file && c.state !== "OK" ? <>{" "}<span className="tag na">{c.file}</span></> : null}
      </>,
      body: c.reasons.map((r, i) => <Line key={i} text={r} tone={i === 0 && ["ISSUE", "MINOR"].includes(c.state) ? "ok" : tone} />),
    });
  };

  const openRule = (id: string) => {
    if (!board) return;
    const r = board.rules.find((x) => x.rule_id === id);
    if (!r) return;
    setRuleId(id);
    const tone = RULE_TONE[r.status] || "na";
    const who = (role?: Role | null) => (role ? ` (${personName(board, role) || (ROLES[role] || words(role)).toLowerCase()})` : "");
    const missing = id === "RULE-11" ? notUploaded(board) : [];
    showDrawer({
      kicker: `${r.rule_id} · ${RULE_WORD[r.status] || r.status}`, title: r.name, help: r.explain || r.help,
      stat: r.status === "OFF" ? <><span className="tag na">Off</span> This rule is switched off in the policy.</>
        : <><span className={`tag ${tone}`}>{RULE_WORD[r.status] || r.status}</span> <b>{r.passed}</b>{" of "}<b>{r.total}</b>{" checks passed"}</>,
      body: <>
        {r.checks.length ? <PagedLines key={id} noun="checks" items={r.checks.map((c, i) => {
          const done = DONE.has(c.status);
          const t = done ? "ok" : c.severity === "BLOCKING" ? "bad" : "warn";
          return <Line key={i} text={c.reason + who(c.party_role)} tone={t} tag={done ? "OK" : OPEN_WORD[c.status] || "Open"} />;
        })} /> : <div className="empty-note">Nothing to check on this case.{id === "RULE-09" ? " No exception has been raised." : ""}</div>}
        {missing.length > 0 && <>
          <div className="list-title">Not uploaded · no file to check</div>
          <PagedLines key={`${id}-missing`} noun="documents" items={missing.map((t, i) => (
            <div className="line" key={i}><span className="edge"></span><div className="grow"><div className="t">{t}</div>
              <div className="d">Counted under Missing documents, not here</div></div><span className="tag na">No file</span></div>
          ))} />
        </>}
      </>,
    });
  };

  const onFilter = (f: Filter) => { setFilter((now) => (now === f ? null : f)); setRenderKey((k) => k + 1); };
  const clearFilter = () => { setFilter(null); setRenderKey((k) => k + 1); };

  // keys: `/` focuses the search, Esc closes the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
      if (e.key === "/" && !typing) { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDrawer]);

  // ?case=CASE-… opens that case directly
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("case");
    if (wanted) void openCase(wanted);
    else inputRef.current?.focus();
  }, []);

  return (
    <>
      <Rail board={board} dark={dark} onToggleTheme={toggleTheme} query={query} onQuery={setQuery}
        onSearch={() => void openCase(query)} loading={loading} error={error} inputRef={inputRef} recent={recent}
        onOpenCase={(id) => void openCase(id)} activeRule={drawerOpen ? ruleId : null} onOpenRule={openRule} />

      <SidebarToggle />

      <main className="main" id="main">
        <div className="loadbar" aria-hidden="true"></div>
        <Welcome />
        {board ? (
          <ResultPage {...toResultPage(board, {
            checkedAt,
            onRecheck: () => void openCase(board.case.case_id, { keepFilter: true }),
          })}>
            <Banner key={`b${renderKey}`} board={board} filter={filter} onFilter={onFilter} />
            <section className="body">
              <People key={`p${renderKey}`} board={board} filter={filter} onClearFilter={clearFilter} onOpenDoc={openDoc} />
              <Brief key={`r${renderKey}`} board={board} onOpenDoc={openDoc} />
            </section>
          </ResultPage>
        ) : null}
      </main>

      <Drawer open={drawerOpen} content={drawer} onClose={closeDrawer} />
      <Toast state={toastState} />
    </>
  );
}
