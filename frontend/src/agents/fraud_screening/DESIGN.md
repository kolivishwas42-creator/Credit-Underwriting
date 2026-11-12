# Fraud Screening — Design System

**Version** 3.0 · **Updated** 11 November 2026 · **Screen** `frontend/src/agents/fraud_screening/` (tab **Fraud Screening**, `/fraud_screening`)
**Inherits** Ink & Ember v3.0 (`docs/DESIGN.md`) + console rules (`frontend/DESIGN.md`); only what is particular to this
agent is written here. *Generated from the code: `python -I gen_agent_design_md.py`.*

## 1. Direction
Fraud rules, AML and PEP — stage **Risk**, API `/api/v1/credit/fraud-screening`. Common result layout: compact header → AI summary (Strengths | Concerns) →
calculations | rules (cards) → actions. The rules decide; the screen shows.

## 2. Principles
As `docs/DESIGN.md`, plus: no orange, no black buttons; the page never grows with the data (6 rule cards per page).

## 3. Color
Common: navy `#172554` creates (buttons) · dark blue `#1E40AF` marks (tab, focus, selection, Hold) · link `#4F5AC7`
informs · slate neutrals (canvas `#F4F6FA`, border `#E2E8F0`, text `#0F172A`/`#64748B`) · band `#0F172A → #21245E`.
Tones: pass `#15803D` · review `#B45309` · fail `#DC2626` · info `#4F5AC7` · na `#64748B`.

**This agent's recommendation colours** (`utils/resultView.ts`):
```
Tone of the overall risk level:
  LOW              -> pass
  MEDIUM           -> review
  HIGH / CRITICAL  -> fail
  anything else    -> na

Tone of one rule result:
  disabled (enabled === false)                -> na     "Disabled"
  triggered, severity HIGH / CRITICAL         -> fail   "Triggered"
  triggered, any other severity               -> review "Triggered"
  not triggered                               -> pass   "Passed"
  listed in skipped_rules                     -> na     "Skipped"
```

## 4. Typography · 5. Spacing · 6. Radius · 7. Elevation
As `docs/DESIGN.md`: Space Grotesk titles / numbers, Lexend 15/22 body, mono for IDs · spacing 4–24 · radii 6 / 8 /
12 / 16 / 20 · borders before shadows (only the basic card and pop-overs float).

## 8. Iconography
Emblem `alert` — tab, overview card, basic card, loader seal. Status icons ✓ ⏱ ✕ –.

## 9. Components
Shared: compact header (Rules / Passed / Review / Failed), AI summary with Strengths | Concerns, Calculations, Rules
(card grid, 6 per page, failed first), ActionBar, Pagination, Loader — the same names on every agent. Own: pages one screen (`App`);
components `Rules`, `Screening`.

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
**Loader**: **run**: Evaluating the application… → Running the fraud rules… → Screening AML and PEP lists… → Weighing the risk…

## 15. Implementation
Adapter `utils/resultView.ts` → `toResultPage()` · loader `useAgentLoader(busy, "run")` · CSS scoped to
`html.agent-fraud_screening` · proxy override `FRS_API` · paginated: `components/Rules.tsx` (rules), `components/Screening.tsx` (records) · tests: `app.test.tsx`.

## 16. Do and don't
Do keep the API's words and map them to a tone; do page every growing list. Don't use orange or black buttons; don't
decide anything in the screen.

## 17. Governance
Common values change in `docs/DESIGN.md` / `frontend/src/shared/styles` first, then regenerate this file.
**11 November 2026**: v3 slate, ember → dark blue, buttons → navy, bands navy, Legal's loader. **7 Nov 2026**: one console,
common result layout, pagination.
