# Document Desk — Design System

**Version** 3.0 · **Updated** 11 November 2026 · **Screen** `frontend/src/agents/docs_policy/` (tab **Document Desk**, `/docs_policy`)
**Inherits** Ink & Ember v3.0 (`docs/DESIGN.md`) + console rules (`frontend/DESIGN.md`); only what is particular to this
agent is written here. *Generated from the code: `python -I gen_agent_design_md.py`.*

## 1. Direction
Credit document readiness by policy — stage **Application**, API `/api/v1/credit/document-readiness`. Common result layout: compact header → AI summary (Strengths | Concerns) →
calculations | rules (cards) → actions. The rules decide; the screen shows.

## 2. Principles
As `docs/DESIGN.md`, plus: no orange, no black buttons; the page never grows with the data (6 rule cards per page).

## 3. Color
Common: navy `#172554` creates (buttons) · dark blue `#1E40AF` marks (tab, focus, selection, Hold) · link `#4F5AC7`
informs · slate neutrals (canvas `#F4F6FA`, border `#E2E8F0`, text `#0F172A`/`#64748B`) · band `#0F172A → #21245E`.
Tones: pass `#15803D` · review `#B45309` · fail `#DC2626` · info `#4F5AC7` · na `#64748B`.

**This agent's recommendation colours** (`utils/resultView.ts`):
```
basic card -> AI summary -> rules | calculations -> actions.
Tone mapping (the desk's own tones -> the layout's Tone):
  route MOVE_AHEAD / MOVE_AHEAD_WITH_NOTES -> pass,  AWAIT_APPROVAL -> review,  REFER_TO_AUTHORITY -> fail
  rule  PASS -> pass,  WARN (to collect) -> review,  FAIL (critical) -> fail,  N/A and OFF -> na
  document ok -> pass,  warn / approval -> review,  bad -> fail
```

## 4. Typography · 5. Spacing · 6. Radius · 7. Elevation
As `docs/DESIGN.md`: Space Grotesk titles / numbers, Lexend 15/22 body, mono for IDs · spacing 4–24 · radii 6 / 8 /
12 / 16 / 20 · borders before shadows (only the basic card and pop-overs float).

## 8. Iconography
Emblem `file-check` — tab, overview card, basic card, loader seal. Status icons ✓ ⏱ ✕ –.

## 9. Components
Shared: compact header (Rules / Passed / Review / Failed), AI summary with Strengths | Concerns, Calculations, Rules
(card grid, 6 per page, failed first), ActionBar, Pagination, Loader — the same names on every agent. Own: pages one screen (`App`);
components `Banner`, `Brief`, `Drawer`, `Icons`, `People`, `Rail`, `Toast`, `Welcome`.

## 10. Data visualization
Counters and status chips.

## 11. Interaction states
As common: hover raised `#F1F5F9`, dark-blue focus ring, loader over this agent's area while it works.

## 12. Layout and responsive
Laptop: calculations (left) | rule cards (right) · tablet / mobile: one column, 2 × 2 facts and buttons · no sideways scroll.

## 13. Accessibility
Status always word + icon; text ≥ 4.5:1; keyboard and focus ring everywhere; reduced motion respected.

## 14. UX copy
**Actions**: Copy brief (ghost, wired) · Copy case ID (ghost, wired) · Download report (ghost, wired) · Re-check (secondary, wired) · Hold (warning) · Refer to authority (danger) · Send to underwriting (primary)
**Loader**: **run**: Checking the documents… → Reading every person's file… → Applying the credit document policy… → Sorting critical, to collect and verified…

## 15. Implementation
Adapter `utils/resultView.ts` → `toResultPage()` · loader `useAgentLoader(busy, "run")` · CSS scoped to
`html.agent-docs_policy` · proxy override `DCP_API` · paginated: `components/Drawer.tsx` (rows), `components/People.tsx` (documents) · tests: `app.test.tsx`, `proxyRules.test.ts`, `resultView.test.ts`, `sentences.test.ts`.

## 16. Do and don't
Do keep the API's words and map them to a tone; do page every growing list. Don't use orange or black buttons; don't
decide anything in the screen.

## 17. Governance
Common values change in `docs/DESIGN.md` / `frontend/src/shared/styles` first, then regenerate this file.
**11 November 2026**: v3 slate, ember → dark blue, buttons → navy, bands navy, Legal's loader. **7 Nov 2026**: one console,
common result layout, pagination.
