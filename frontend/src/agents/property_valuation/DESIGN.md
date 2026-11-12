# Property Valuation — Design System

**Version** 3.0 · **Updated** 11 November 2026 · **Screen** `frontend/src/agents/property_valuation/` (tab **Property Valuation**, `/property_valuation`)
**Inherits** Ink & Ember v3.0 (`docs/DESIGN.md`) + console rules (`frontend/DESIGN.md`); only what is particular to this
agent is written here. *Generated from the code: `python -I gen_agent_design_md.py`.*

## 1. Direction
Vendor valuation assessment — stage **Property**, API `/api/v1/credit/property-valuation`. Common result layout: compact header → AI summary (Strengths | Concerns) →
calculations | rules (cards) → actions. The rules decide; the screen shows.

## 2. Principles
As `docs/DESIGN.md`, plus: no orange, no black buttons; the page never grows with the data (6 rule cards per page).

## 3. Color
Common: navy `#172554` creates (buttons) · dark blue `#1E40AF` marks (tab, focus, selection, Hold) · link `#4F5AC7`
informs · slate neutrals (canvas `#F4F6FA`, border `#E2E8F0`, text `#0F172A`/`#64748B`) · band `#0F172A → #21245E`.
Tones: pass `#15803D` · review `#B45309` · fail `#DC2626` · info `#4F5AC7` · na `#64748B`.

**This agent's recommendation colours** (`utils/resultView.ts`):
```
Tone of the agent status:
  CLEAR      -> pass
  REVIEW     -> review
  HIGH_RISK  -> fail   (and any other status: assess() treats it as high risk)

Tone of one rule:
  not triggered                               -> pass   "Passed"
  triggered, band CRITICAL (CRITICAL / HIGH)  -> fail   "Triggered"
  triggered, band MEDIUM or LOW               -> review "Triggered"
```

## 4. Typography · 5. Spacing · 6. Radius · 7. Elevation
As `docs/DESIGN.md`: Space Grotesk titles / numbers, Lexend 15/22 body, mono for IDs · spacing 4–24 · radii 6 / 8 /
12 / 16 / 20 · borders before shadows (only the basic card and pop-overs float).

## 8. Iconography
Emblem `building` — tab, overview card, basic card, loader seal. Status icons ✓ ⏱ ✕ –.

## 9. Components
Shared: compact header (Rules / Passed / Review / Failed), AI summary with Strengths | Concerns, Calculations, Rules
(card grid, 6 per page, failed first), ActionBar, Pagination, Loader — the same names on every agent. Own: pages one screen (`App`);
components `FormField`, `HistoryTab`, `ResultView`, `RulesTab`, `ValuationTab`.

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
**Loader**: **fetch**: Fetching the application from LOS… → Loading its properties… · **run**: Saving the vendor response… → Running the valuation rules… → Comparing LOS and vendor values… → Writing the assessment…

## 15. Implementation
Adapter `utils/resultView.ts` → `toResultPage()` · loader `useAgentLoader(busy, "run")` · CSS scoped to
`html.agent-property_valuation` · proxy override `PRV_API` · paginated: `components/HistoryTab.tsx` (results, visits), `components/ResultView.tsx` (fields), `components/RulesTab.tsx` (rules) · tests: `app.test.tsx`.

## 16. Do and don't
Do keep the API's words and map them to a tone; do page every growing list. Don't use orange or black buttons; don't
decide anything in the screen.

## 17. Governance
Common values change in `docs/DESIGN.md` / `frontend/src/shared/styles` first, then regenerate this file.
**11 November 2026**: v3 slate, ember → dark blue, buttons → navy, bands navy, Legal's loader. **7 Nov 2026**: one console,
common result layout, pagination.
