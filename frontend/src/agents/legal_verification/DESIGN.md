# Legal — Design System

**Version** 3.0 · **Updated** 11 November 2026 · **Screen** `frontend/src/agents/legal_verification/` (tab **Legal**, `/legal_verification`)
**Inherits** Ink & Ember v3.0 (`docs/DESIGN.md`) + console rules (`frontend/DESIGN.md`); only what is particular to this
agent is written here. *Generated from the code: `python -I gen_agent_design_md.py`.*

## 1. Direction
Legal verification of the collateral — stage **Property**, API `/api/v1/credit/legal-verification`. Common result layout: compact header → AI summary (Strengths | Concerns) →
calculations | rules (cards) → actions. The rules decide; the screen shows.

## 2. Principles
As `docs/DESIGN.md`, plus: no orange, no black buttons; the page never grows with the data (6 rule cards per page).

## 3. Color
Common: navy `#172554` creates (buttons) · dark blue `#1E40AF` marks (tab, focus, selection, Hold) · link `#4F5AC7`
informs · slate neutrals (canvas `#F4F6FA`, border `#E2E8F0`, text `#0F172A`/`#64748B`) · band `#0F172A → #21245E`.
Tones: pass `#15803D` · review `#B45309` · fail `#DC2626` · info `#4F5AC7` · na `#64748B`.

**This agent's recommendation colours** (`utils/resultView.ts`):
```
Rule status -> tone: FAIL (mismatch) = fail, REVIEW = review, PASS = pass, NOT_APPLICABLE / anything else = na.

Recommendation -> tone: ESCALATE = fail, REVIEW_REQUIRED = review, CLEAR_FOR_REVIEW = pass.

comparison match -> tone: true = pass, false = fail, null (not confirmed) = review
```

## 4. Typography · 5. Spacing · 6. Radius · 7. Elevation
As `docs/DESIGN.md`: Space Grotesk titles / numbers, Lexend 15/22 body, mono for IDs · spacing 4–24 · radii 6 / 8 /
12 / 16 / 20 · borders before shadows (only the basic card and pop-overs float).

## 8. Iconography
Emblem `scale` — tab, overview card, basic card, loader seal. Status icons ✓ ⏱ ✕ –.

## 9. Components
Shared: compact header (Rules / Passed / Review / Failed), AI summary with Strengths | Concerns, Calculations, Rules
(card grid, 6 per page, failed first), ActionBar, Pagination, Loader — the same names on every agent. Own: pages `CasePage`, `WorklistPage`;
components `ApplicationStep`, `Documents`, `Loader`, `Outcome`, `Typewriter`, `VerificationReport`, `kit`.

## 10. Data visualization
Counters and status chips · typed brand title in the rail.

## 11. Interaction states
As common: hover raised `#F1F5F9`, dark-blue focus ring, loader over this agent's area while it works.

## 12. Layout and responsive
Laptop: calculations (left) | rule cards (right) · tablet / mobile: one column, 2 × 2 facts and buttons · no sideways scroll.

## 13. Accessibility
Status always word + icon; text ≥ 4.5:1; keyboard and focus ring everywhere; reduced motion respected.

## 14. UX copy
**Actions**: Download report (ghost, wired) · Validate again (secondary, wired) · Proceed (primary, wired) · Escalate to legal (danger, wired) · Reject collateral (danger, wired) · Send back to agency (secondary, wired) · Final status (primary, wired)
**Loader**: **run**: Running the ten legal rules… → Comparing the Sale Deed and the agency report… → Writing the summary…

## 15. Implementation
Adapter `utils/resultView.ts` → `toResultPage()` · loader `useAgentLoader(busy, "run")` · CSS scoped to
`html.agent-legal_verification` · proxy override `LGV_API` · paginated: `components/Documents.tsx` (documents), `components/Outcome.tsx` (events), `pages/WorklistPage.tsx` (cases) · tests: `app.test.tsx`.

## 16. Do and don't
Do keep the API's words and map them to a tone; do page every growing list. Don't use orange or black buttons; don't
decide anything in the screen.

## 17. Governance
Common values change in `docs/DESIGN.md` / `frontend/src/shared/styles` first, then regenerate this file.
**11 November 2026**: v3 slate, ember → dark blue, buttons → navy, bands navy, Legal's loader. **7 Nov 2026**: one console,
common result layout, pagination.
