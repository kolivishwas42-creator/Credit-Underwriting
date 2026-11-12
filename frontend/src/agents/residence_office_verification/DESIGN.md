# Residence / Office — Design System

**Version** 3.0 · **Updated** 11 November 2026 · **Screen** `frontend/src/agents/residence_office_verification/` (tab **Residence / Office**, `/residence_office_verification`)
**Inherits** Ink & Ember v3.0 (`docs/DESIGN.md`) + console rules (`frontend/DESIGN.md`); only what is particular to this
agent is written here. *Generated from the code: `python -I gen_agent_design_md.py`.*

## 1. Direction
Residence and office visit checks — stage **Verification**, API `/api/v1/credit/residence-office-verification`. Common result layout: compact header → AI summary (Strengths | Concerns) →
calculations | rules (cards) → actions. The rules decide; the screen shows.

## 2. Principles
As `docs/DESIGN.md`, plus: no orange, no black buttons; the page never grows with the data (6 rule cards per page).

## 3. Color
Common: navy `#172554` creates (buttons) · dark blue `#1E40AF` marks (tab, focus, selection, Hold) · link `#4F5AC7`
informs · slate neutrals (canvas `#F4F6FA`, border `#E2E8F0`, text `#0F172A`/`#64748B`) · band `#0F172A → #21245E`.
Tones: pass `#15803D` · review `#B45309` · fail `#DC2626` · info `#4F5AC7` · na `#64748B`.

**This agent's recommendation colours** (`utils/resultView.js`):
```
Pure: (API result, the form that was sent, the AI summary) -> ResultPageProps. Only fields the API returns.
Tone mapping (RuleRow.outcome):
  rule not triggered                         -> pass   (label: the rule's own status, e.g. "PASS")
  triggered, criticality CRITICAL or HIGH    -> fail   (label "Triggered")
  triggered, criticality MEDIUM / LOW / none -> review (label "Triggered")
Overall recommendation word -> decision tone: approve/pass/positive -> pass; reject/fail/negative/decline -> fail;
refer/review/hold -> review; anything else -> info.

Text -> sentences / bullet lines (no empties).
```

## 4. Typography · 5. Spacing · 6. Radius · 7. Elevation
As `docs/DESIGN.md`: Space Grotesk titles / numbers, Lexend 15/22 body, mono for IDs · spacing 4–24 · radii 6 / 8 /
12 / 16 / 20 · borders before shadows (only the basic card and pop-overs float).

## 8. Iconography
Emblem `home` — tab, overview card, basic card, loader seal. Status icons ✓ ⏱ ✕ –.

## 9. Components
Shared: compact header (Rules / Passed / Review / Failed), AI summary with Strengths | Concerns, Calculations, Rules
(card grid, 6 per page, failed first), ActionBar, Pagination, Loader — the same names on every agent. Own: pages one screen (`App`);
components the screen keeps its parts in `App`.

## 10. Data visualization
Counters and status chips.

## 11. Interaction states
As common: hover raised `#F1F5F9`, dark-blue focus ring, loader over this agent's area while it works.

## 12. Layout and responsive
Laptop: calculations (left) | rule cards (right) · tablet / mobile: one column, 2 × 2 facts and buttons · no sideways scroll.

## 13. Accessibility
Status always word + icon; text ≥ 4.5:1; keyboard and focus ring everywhere; reduced motion respected.

## 14. UX copy
**Actions**: Download report (ghost) · Hold (warning) · Decline (danger) · Submit (primary)
**Loader**: **run**: Reviewing the field report… → Running the residence rules… → Weighing neighbour and address checks… → Writing the risk summary…

## 15. Implementation
Adapter `utils/resultView.js` → `toResultPage()` · loader `useAgentLoader(busy, "run")` · CSS scoped to
`html.agent-residence_office_verification` · proxy override `ROV_API` · paginated: `App.jsx` (rules) · tests: `src/test/residence_resultView.test.ts`.

## 16. Do and don't
Do keep the API's words and map them to a tone; do page every growing list. Don't use orange or black buttons; don't
decide anything in the screen.

## 17. Governance
Common values change in `docs/DESIGN.md` / `frontend/src/shared/styles` first, then regenerate this file.
**11 November 2026**: v3 slate, ember → dark blue, buttons → navy, bands navy, Legal's loader. **7 Nov 2026**: one console,
common result layout, pagination.
