# Ink & Ember — Design System

**Version** 2.0 · **Last updated** 7 September 2026
**Product** Second Brain (enterprise knowledge workspace)
**Reference implementation** `ink-ember-demo.html`

---

## Table of contents

1. [Direction](#1-direction)
2. [Principles](#2-principles)
3. [Color](#3-color)
4. [Typography](#4-typography)
5. [Spacing](#5-spacing)
6. [Radius](#6-radius)
7. [Elevation and surfaces](#7-elevation-and-surfaces)
8. [Iconography](#8-iconography)
9. [Components](#9-components)
10. [Data visualization](#10-data-visualization)
11. [Interaction states](#11-interaction-states)
12. [Layout and responsive](#12-layout-and-responsive)
13. [Accessibility](#13-accessibility)
14. [UX copy](#14-ux-copy)
15. [Implementation](#15-implementation)
16. [Do and don't](#16-do-and-dont)
17. [Governance](#17-governance)

---

## 1. Direction

Ink & Ember is a **three-role** color system for a dense, long-session enterprise application.

Most enterprise palettes fail the same way: one brand hue is asked to mean "our product", "this is a link", "this is selected", and "this is informational" all at once, so nothing in the interface can be read at a glance. This system splits those jobs across three colors and refuses to let any of them drift:

| Color | Job | Where it appears |
|---|---|---|
| **Ink** `#18181B` | **Creates.** The action that makes or changes something. | Primary buttons, FAB, toast |
| **Ember** `#F4511E` | **Marks.** What you have selected, what is active, what needs you now. | Checked boxes, selected row wash and rule, active nav mark, active page number, toggle on, priority chips, notification dot |
| **Link** `#4F5AC7` | **Informs.** The system speaking, or a way forward. | Links, informational chips, category dots |

Everything else is a **pure neutral grey** — no hue bias at all, which is what leaves ember as the only warm thing on the screen and therefore impossible to miss. Status lives in its own pastel family (green, amber, red on tinted grounds) so a table row can be simultaneously *selected* and *failing* without the two signals fighting for the same pixel.

**Where it fits:** data tables, admin consoles, product and inventory tooling, anything operated for hours at a time.
**Where to be careful:** ember is high-energy. If the product's screens are 60% tables with 30 rows selected at a time, reduce `emberTint` toward the neutral end rather than letting the whole page glow.

---

## 2. Principles

**1. Three colors, three verbs.**
Ink creates, ember marks, indigo informs. A fourth job means a fourth conversation, not a fourth color.

**2. Ember is a mark, not a mood.**
It is never decoration and never a section theme. If you cannot name what it is selecting or flagging, remove it.

**3. Neutrals are pure grey.**
No warm or cool bias. The moment a neutral leans orange, ember stops standing out.

**4. Selection and status never share a channel.**
Ember owns selection. The pastel family owns status. This is what lets both be true of one row.

**5. Hierarchy from fill, not from hue.**
Solid fill → tinted fill → border → bare. Four legible levels without touching the accent.

**6. State is never color alone.**
Every status carries a word. Every selection carries a shape (a rule, a tick) as well as a wash.

**7. Borders before shadows.**
Resting surfaces separate with 1px. Shadow means genuinely floating.

**8. One ink button per view.**
Ink is the loudest thing on the page. Two of them cancel out.

**9. Two faces, one job each.**
Space Grotesk never drops below a title. Lexend never sets a headline.

**10. Dark mode is authored, not inverted.**
Ink flips polarity to near-white; ember *lifts* so it still reads as a mark on a near-black ground.

---

## 3. Color

### 3.1 Ink — the action color

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | `#18181B` | `#FAFAFA` | Primary button, FAB, toast, selected filter chip |
| `inkHover` | `#27272A` | `#FFFFFF` | Hover |
| `inkPressed` | `#09090B` | `#E4E4E7` | Pressed |
| `inkDisabled` | `#D4D4D8` | `#3F3F46` | Disabled primary |
| `onInk` | `#FFFFFF` | `#18181B` | Text and icons on ink |

Ink is also `textPrimary`. A filled button and a heading are the same value — that shared value is what makes the UI feel like one material.

> **Dark mode.** Ink does not become dark grey; it becomes near-white with dark text. The concept is *maximum contrast against the page*, and that concept inverts. Getting this wrong is the most common way a monochrome-led system falls apart in dark mode.

### 3.2 Ember — the selection and attention color

| Token | Light | Dark | Use |
|---|---|---|---|
| `ember` | `#F4511E` | `#FF6B3D` | Checkbox fill, selected-row rule, active-nav mark, active page number, toggle on, notification dot, sparkline highlight bar |
| `emberHover` | `#DC4517` | `#FF8459` | Hover on ember fills |
| `emberPressed` | `#C23C13` | `#E2542A` | Pressed |
| `emberSubtle` | `#FEF0EA` | `#2E1810` | Priority chip, callout fill |
| `emberTint` | `#FDF6F3` | `#1F1310` | Selected row / list wash |
| `emberText` | `#C0400F` | `#FF9068` | Any ember-colored **word** |

> **The rule that matters.** `ember` measures **3.5:1** on white. That clears the 3:1 bar for UI components, icons, borders and fills — and fails the 4.5:1 bar for small text. Every ember *word* in this system uses `emberText` on `emberSubtle`, which measures **4.7:1**. Skipping this is the single most common way an orange accent fails an audit.

Two rationed exceptions where ember carries a full button (`.btn-accent`): an upgrade or promotional action, and nothing else. It is never a second primary alongside the ink button.

### 3.3 Link — the informational color

| Token | Light | Dark | Use |
|---|---|---|---|
| `link` | `#4F5AC7` | `#8B94E8` | Inline links, "view all" actions |
| `linkHover` | `#3F49AB` | `#A5ACF0` | Link hover |
| `infoSubtle` | `#EEF0FC` | `#1D2040` | Informational chip fill |
| `infoText` | `#4148A8` | `#A3AAF0` | Text on `infoSubtle` — 6.8:1 |

A desaturated indigo. Because ember owns selection, indigo is free to mean exactly one thing: *here is information, or here is a way forward*.

### 3.4 Neutral ramp — pure grey

No hue bias by design. Eight steps, carrying roughly 90% of the pixels.

| Token | Light | Dark | Use |
|---|---|---|---|
| `canvas` | `#F7F7F8` | `#0C0C0D` | Page background |
| `surface` | `#FFFFFF` | `#141416` | Cards, sheets, inputs, bars, table |
| `raised` | `#F4F4F5` | `#1D1D20` | Secondary buttons, tab container, neutral chips, hover fills, icon wells |
| `raisedHover` | `#EBEBED` | `#26262A` | Hover on `raised` |
| `border` | `#EAEAEC` | `#27272A` | Card, input and table borders |
| `borderStrong` | `#D4D4D8` | `#3F3F46` | Checkbox border, drag handle, card hover |
| `divider` | `#F0F0F1` | `#1F1F22` | Rules inside a container, table row separators |
| `textPrimary` | `#18181B` | `#FAFAFA` | Headings, body, cell values |
| `textSecondary` | `#71717A` | `#A1A1AA` | Metadata, captions, column headers |
| `textDisabled` | `#A1A1AA` | `#71717A` | Placeholders, completed text, neutral dots |
| `iconDefault` | `#3F3F46` | `#D4D4D8` | Standalone icons |

### 3.5 Status — a family of its own

Pastel fill, dark text. Deliberately separate from all three role colors.

| Token | Light | Dark | Contrast on surface (light) |
|---|---|---|---|
| `success` | `#1E8E3E` | `#3FA65C` | 4.2:1 — fills and icons |
| `successSubtle` | `#E7F4EB` | `#102416` | — |
| `successText` | `#177334` | `#6FCB8D` | 5.9:1 ✓ |
| `warning` | `#C08A1E` | `#D9A13A` | 3.1:1 — fills and icons only |
| `warningSubtle` | `#FDF3E0` | `#2A2010` | — |
| `warningText` | `#96690F` | `#E8BC63` | 4.9:1 ✓ |
| `error` | `#D14343` | `#E06A6A` | 4.6:1 ✓ |
| `errorHover` | `#B63838` | `#EC8585` | — |
| `errorSubtle` | `#FDECEC` | `#2E1818` | — |
| `errorText` | `#B03535` | `#F09090` | 5.4:1 ✓ |
| `rating` | `#F5A623` | `#F5B342` | Icon only — always beside its numeral |

`success` and `warning` do not clear 4.5:1 for small text on white. Use them for fills, dots, borders and icons; use `successText` / `warningText` whenever the status is a word.

### 3.6 Utility

| Token | Light | Dark |
|---|---|---|
| `onColor` | `#FFFFFF` | `#FFFFFF` | Text on any saturated fill (ember, error), both themes |
| `scrim` | `rgba(24,24,27,.5)` | `rgba(0,0,0,.7)` |

### 3.7 Contrast reference

| Pair | Ratio | WCAG |
|---|---|---|
| `textPrimary` on `surface` | 17.1:1 | AAA |
| `onInk` on `ink` | 16.4:1 | AAA |
| `textSecondary` on `surface` | 4.9:1 | AA |
| `link` on `surface` | 5.8:1 | AA |
| `emberText` on `emberSubtle` | 4.7:1 | AA |
| `infoText` on `infoSubtle` | 6.8:1 | AA |
| `ember` on `surface` | 3.5:1 | UI components only |
| `textDisabled` on `surface` | 2.6:1 | Non-text only |
| `textPrimary` on `surface` (dark) | 16.1:1 | AAA |
| `textSecondary` on `surface` (dark) | 7.1:1 | AAA |

### 3.8 Color usage rules

- Exactly **one** ink-filled element per view as the primary action.
- Ember only where something is selected, active, or needs the user now. Never as decoration, never as a section theme.
- Ember never sets small text. `emberText` on `emberSubtle` does.
- Link/indigo for links and information. Never for a category fill or a selection.
- Category chips stay neutral with a colored dot. Only status chips get filled.
- Never introduce a hue bias into the neutral ramp.
- Never encode meaning in color alone.

---

## 4. Typography

Two faces, both from Google Fonts.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Lexend:wght@400;500;600;700&display=swap">
```

```css
--font-display: 'Space Grotesk', 'Inter', -apple-system, "Segoe UI", sans-serif;
--font-body:    'Lexend', 'Inter', -apple-system, "Segoe UI", Roboto, sans-serif;
```

### 4.1 Role split — this is a hard rule

| Face | Applies to | Never applies to |
|---|---|---|
| **Space Grotesk** | `h1`–`h4`, display, page titles, section titles, card titles, brand name, uppercase eyebrows, stat-tile figures | Body copy, list titles, labels, captions, buttons, chips, table data |
| **Lexend** | Body, list item titles, form labels, buttons, chips, captions, metadata, table data, tabular figures | Any headline |

Space Grotesk is a display face. Its wide bowls and cut terminals are what give this monochrome UI its only real voice — and the same features make it tiring below about 18px. It stops at titles.

Lexend was drawn to raise reading proficiency: tall x-height, open counters, generous default spacing. It takes every line someone actually reads.

### 4.2 Scale

| Style | Face | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|---|
| Display | Space Grotesk | 32 / 40 | 700 | −0.03em | Hero, empty-state headline |
| H1 | Space Grotesk | 28 / 36 | 700 | −0.03em | Page title |
| H2 | Space Grotesk | 24 / 32 | 700 | −0.02em | Major section |
| H3 | Space Grotesk | 20 / 28 | 600 | −0.015em | Section head, card title |
| Card title | Space Grotesk | 18 / 26 | 600 | −0.015em | Note card, list card |
| Eyebrow | Space Grotesk | 12 / 16 | 600 | **+0.09em** | Uppercase kicker |
| Stat figure | Space Grotesk | 28 / 36 | 700 | −0.03em | Stat tile number |
| Body large | Lexend | 17 / 26 | 400 | −0.006em | Page subtitle, lead |
| Body | Lexend | 15 / 22 | 400 | −0.006em | Default |
| Body medium | Lexend | 15 / 22 | 500 | −0.006em | List item title, emphasis |
| Prose | Lexend | 16 / 28 | 400 | −0.006em | Long-form reading |
| Caption | Lexend | 13 / 18 | 400 | −0.006em | Metadata, help text |
| Small | Lexend | 12 / 16 | 500 | −0.006em | Timestamps, counts |

### 4.3 Why the tracking differs

The two faces have different natural widths, so tracking cannot be copied between them.

- **Space Grotesk sets tight.** At display sizes the default spacing already feels close; pushing to −0.03em turns that into intent rather than accident. Set uppercase, it needs the opposite: the eyebrow opens to **+0.09em**, noticeably more than the +0.06em that suited Inter.
- **Lexend sets wide.** Its generous default spacing is a reading feature at 16px and a liability in a dense list. Body tracking closes to **−0.006em**.
- **Lexend's x-height is tall,** so long-form leading rises from 26px to **28px** and the measure tightens from 68ch to **66ch**. Without this, prose feels crowded even at correct line length.

### 4.4 Typography rules

- Maximum three weights on one screen.
- Running text stays between 60 and 70 characters. Prose containers cap at 66ch.
- Numbers that line up in columns get `font-variant-numeric: tabular-nums`.
- Headings get `text-wrap: balance`.
- Never set Space Grotesk below 18px except the uppercase eyebrow at 12px, where the caps height carries it.
- Body text never goes below 13px. Default is 15px.

> **Density note.** Lexend reads about 3–4% larger than Inter at the same nominal size. If a data-dense table feels loose, drop that table's body to 14/20 rather than tightening tracking further.

---

## 5. Spacing

A strict 4px base grid.

| Token | Value | Typical use |
|---|---|---|
| `space1` | 4px | Icon-to-text micro gap, chip dot gap |
| `space2` | 8px | Compact gap, chip row gap, title-to-subtitle |
| `space3` | 12px | Control internal gap, list item padding, card gap |
| `space4` | 16px | Standard card padding, section internal gap |
| `space5` | 20px | Large card padding, sheet padding |
| `space6` | 24px | Section spacing, desktop page padding |
| `space7` | 28px | Large section gap |
| `space8` | 32px | Major layout separation, section bottom margin |
| `space10` | 40px | Empty-state padding |
| `space12` | 48px | Hero separation, desktop page bottom |

**Rules**

- No arbitrary values. 13px, 17px, 19px, 23px do not exist unless correcting optical alignment, and then they get a comment.
- Sibling groups are spaced with flex/grid `gap`, never per-child margins — collapsing and doubling margins are the two most common spacing bugs.
- Content never touches the viewport edge.

**Standard rhythm**

- Between related cards: 12px
- Between card groups: 16px
- Between sections: 24–32px
- Card title → body: 16px
- Title → subtitle: 4–8px

---

## 6. Radius

| Token | Value | Use |
|---|---|---|
| `radiusXs` | 6px | Chips, active tab, page buttons, icon wells, keyboard hints |
| `radiusSm` | 8px | Buttons, inputs, list items, nav items, tab container, toast |
| `radiusMd` | 12px | Bulk-action bar, desktop modal |
| `radiusLg` | 16px | Standard card, table container, FAB |
| `radiusXl` | 20px | Large card, feature panel |
| `radius2Xl` | 24px | Mobile bottom sheet (top corners only) |
| `radiusPill` | 999px | Dots, meters, avatars, toggle track and knob |

**Rules**

- The scale is deliberately tighter than a consumer product's. Dense tables and toolbars read as sharper and more precise at 6–8px; anything softer starts to look like a marketing page.
- Chips use 6px, **not** pill. Pill radius here belongs only to dots, meters, avatars and the toggle.
- Nested radius: an inner element sits at least one step below its container (an 8px row inside a 16px table container).
- Never mix radii within one component.

---

## 7. Elevation and surfaces

Separation comes from borders and surface value. Shadow means *floating*.

| Token | Light | Dark |
|---|---|---|
| `elevationSm` | `0 1px 3px rgba(28,26,23,.06)` | `0 1px 3px rgba(0,0,0,.4)` |
| `elevationMd` | `0 4px 12px rgba(28,26,23,.10)` | `0 4px 12px rgba(0,0,0,.45)` |
| `elevationLg` | `0 12px 32px rgba(28,26,23,.16)` | `0 12px 32px rgba(0,0,0,.55)` |

| Elevation | Applies to |
|---|---|
| None (border only) | Cards, inputs, list items, panels |
| Sm | Card hover, active tab |
| Md | FAB, bottom navigation |
| Lg | Modal, bottom sheet, dropdown, toast |

Dark-mode shadows are opaque black at much higher alpha — a warm low-alpha shadow is invisible on a near-black ground, so the value is re-authored rather than reused.

**Surface stack:** `canvas` → `surface` (+1px `border`) → `raised` for wells and secondary fills. Three levels is the ceiling; a fourth stops reading as a level.

---

## 8. Iconography

One family throughout — the reference build uses 24×24 stroked outline icons, `stroke-width: 2`, round caps and joins.

| Context | Size |
|---|---|
| Inline metadata, chip dot area | 14–16px |
| Standard UI icon | 18–20px |
| Button icon | 18px |
| Navigation icon | 20–22px |
| Feature / empty-state icon | 24–28px |

**Color**

| Role | Token |
|---|---|
| Standalone icon | `iconDefault` |
| Inside a nav item | inherits nav item color |
| On ink | `onInk` |
| Secondary / inactive | `textSecondary` |
| Disabled | `textDisabled` |
| Destructive | `error` |

Never mix filled and outline icon families. Never scale an icon to a non-grid size.

---

## 9. Components

### 9.1 Button

| Property | Value |
|---|---|
| Height | 44px (CTA 48px) |
| Horizontal padding | 16px (CTA 20px) |
| Radius | 8px |
| Type | Lexend 14px / 600 (CTA 15px) |
| Icon | 18px, 8px gap |
| Min touch target | 44 × 44px |

| Variant | Background | Text | Use |
|---|---|---|---|
| Primary | `ink` | `onInk` | The one main action |
| Ember | `ember` | `onColor` | Upgrade / promotional action **only** |
| Secondary | `raised` | `textPrimary` | Supporting actions |
| Outline | `surface` + 1px `border` | `textPrimary` | Toolbar: filter, sort, export |
| Tertiary | transparent | `textPrimary` | Back, cancel, inline |
| Destructive | `error` | `onColor` | Delete, clear, revoke |

| State | Primary | Ember | Secondary | Outline | Destructive |
|---|---|---|---|---|---|
| Hover | `inkHover` | `emberHover` | `raisedHover` | `raised` + `borderStrong` | `errorHover` |
| Pressed | `inkPressed` | `emberPressed` | `raisedHover` | `raised` | `errorHover` |
| Focus | 2px `ember` ring, 2px offset | same | same | same | same |
| Disabled | `inkDisabled` bg, `surface` text, `not-allowed` | — | — | — | — |
| Loading | Spinner replaces icon, label persists, width locked | — | — | — | — |

**Rules**

- One primary per view.
- The ember button is rationed to upgrade and promotional actions. It is never a second primary sitting beside the ink one — two saturated CTAs in a viewport means the user has to decide which is the real action.
- Destructive actions are never the only visible action — always paired with a cancel.
- Button labels say what happens: "Publish", not "Submit". Past tense in the confirmation toast: "Published".

### 9.2 Input

| Property | Value |
|---|---|
| Height | 44px |
| Radius | 8px |
| Padding | 0 12px |
| Border | 1px `border` |
| Background | `surface` |
| Text | Lexend 15px, `textPrimary` |
| Placeholder | `textDisabled` |

| State | Treatment |
|---|---|
| Focus | 2px `ember` border, horizontal padding drops to 11px so the field does not resize |
| Error | 2px `error` border + message below in `errorText` |
| Disabled | `raised` background, `textDisabled` text |
| Read-only | `raised` background, `textPrimary` text, no border change |

Textarea: same treatment, min-height 88px, 12px vertical padding, `resize: vertical`.

Error messages state the fix, not just the fault:
> ✅ "Tags can't contain spaces — try #systems-thinking"
> ❌ "Invalid input"

### 9.3 Tabs

| Property | Value |
|---|---|
| Container | `raised`, radius 8px, padding 3px |
| Tab height | 36px |
| Tab radius | 6px |
| Tab padding | 0 12px |
| Type | Lexend 14px / 500 |

| State | Treatment |
|---|---|
| Active | `surface` background, `textPrimary`, weight 600, `elevationSm` |
| Inactive | transparent, `textSecondary` |
| Hover | `textPrimary` |

The active tab **lifts** to `surface` rather than filling with color, which keeps a toolbar calm and leaves ink free for the page's one primary action.

> **Tab vs page number.** Both are selections, and they get deliberately different treatments: a tab *lifts*, a page number *fills with ember*. A tab switches which view you are looking at; a page number is your position within one set of results. Different question, different signal.

Underline variant (page-level navigation, no container): active text `textPrimary`, 2–3px `ember` indicator, inactive `textSecondary`.

### 9.4 Chips

Two distinct kinds. Confusing them is the fastest way to make this system look noisy.

**Category chip** — neutral fill, colored dot.

| Property | Value |
|---|---|
| Height | 26px (large 30px) |
| Padding | 0 10px (large 12px) |
| Radius | 6px — **not** pill |
| Type | Lexend 12px / 600 (large 13px) |
| Background | `raised` |
| Text | `textSecondary` |
| Dot | 6px circle, 6px gap |

| Dot color | Meaning |
|---|---|
| `link` | Idea, product, review |
| `warning` | Reading, in progress |
| `success` | Meeting, complete |
| `textDisabled` | Inbox, unsorted, low priority |

**Status chip** — filled, for something that needs attention.

| Variant | Background | Text | Use |
|---|---|---|---|
| Success | `successSubtle` | `successText` | Processed, done, on track |
| Warning | `warningSubtle` | `warningText` | Needs review, unsorted |
| Error | `errorSubtle` | `errorText` | Unverified, failed |
| Info | `infoSubtle` | `infoText` | In progress, review |
| Ember | `emberSubtle` | `emberText` | High priority, overdue |
| Emphasis | `ink` | `onInk` | Rare — a count that must dominate |

**Filter chip** — interactive.

| Property | Value |
|---|---|
| Height | 32px, radius 8px, padding 0 12px |
| Rest | `surface`, 1px `border`, `textSecondary` |
| Hover | `raised`, `textPrimary` |
| Selected | `ink` fill, `onInk` text, weight 600 |

**Rule:** a category is not a status. Four note types do not get four colored fills — they get four dots on identical neutral chips. This is what leaves the filled chips free to mean "this one needs you", and lets a selected row still show a red status without the two reading as one signal.

### 9.5 Card

| Variant | Radius | Padding | Border |
|---|---|---|---|
| Standard | 16px | 16px | 1px `border` |
| Large | 20px | 20px | 1px `border` |
| List container | 16px | 8px | 1px `border` |

- Background `surface`, no resting shadow.
- Hover (interactive cards only): border → `borderStrong`, `elevationSm`.
- Internal rhythm: title → subtitle 4px; header → content 16px; content blocks 12–16px.
- Do not nest a bordered card inside a bordered card. Use a divider.

### 9.6 List item

Lighter than a card — lists are scanned, cards are read.

| Property | Value |
|---|---|
| Min height | 52px |
| Padding | 12px |
| Radius | 8px |
| Separator | 1px `divider` between items |
| Hover | `raised` background |
| Selected | `emberTint` background + 3px `ember` rule on the leading edge |
| Leading icon well | 34px, radius 6px, `raised` background |
| Gap | 12px between icon, body, trailing |

Structure: `[icon well] [title / metadata] [trailing chips]`.
Title is Lexend 15/500 `textPrimary`, single line with ellipsis. Metadata is 13/400 `textSecondary`, single line with ellipsis.

Do not border every list item. Prefer dividers, hover fill, and grouping.

### 9.7 Checkbox

| Property | Value |
|---|---|
| Size | 20 × 20px (44px touch target via the row) |
| Radius | 6px |
| Border | 1.5px `borderStrong` |
| Hover | border → `ember` |
| Checked | `ember` fill, `onColor` tick |
| Focus | 2px `ember` ring |

The checkbox fills **ember, not ink** — a tick is a selection, and selection is ember's job. This is also what makes a selected table row legible at a glance: the tick, the wash and the leading rule are all the same colour, and all three appear together.

Completed row: title → `textDisabled` with line-through, trailing chips → 55% opacity. Three signals, only one of which is color.

### 9.8 Navigation

**Sidebar (≥1024px)**

| Property | Value |
|---|---|
| Width | 256px |
| Background | `surface`, 1px right `border` |
| Padding | 20px 12px |
| Group label | Lexend 11px / 600, +0.08em, uppercase, `textDisabled` |
| Item height | 44px, radius 8px, padding 0 12px |
| Active | `surface` fill + 1px `border` + `elevationSm`, weight 600, plus a **3px × 24px ember rule** on the sidebar's leading edge |
| Hover | `raised`, `textPrimary` |
| Count badge | pill, `raised` / `textSecondary` |
| Workspace dot | 8px, colored per workspace |

The active item is **not** an ink fill. It lifts to surface and is marked by an ember rule — so a user scanning the sidebar finds their location by the same colour that marks selection everywhere else, and ink stays reserved for the one action that creates something.

**Top bar**

| Property | Value |
|---|---|
| Height | 56px mobile / 64px ≥768px |
| Background | `surface`, 1px bottom `border`, sticky |
| Icon button | 40px (44px ≥768px), radius 8px |
| Notification dot | 8px `ember`, 2px `surface` ring |
| Avatar stack | 32px circles, −10px overlap, 2px `surface` ring; overflow badge on `ember` |

**Bottom navigation (<1024px)**

| Property | Value |
|---|---|
| Item min height | 52px |
| Type | Lexend 11px / 500 (600 active) |
| Active mark | 20 × 3px `ember` rule at the top of the item |
| Elevation | `elevationMd` |
| Safe area | `env(safe-area-inset-bottom)` added to bottom padding |

Same reasoning as the sidebar: a rule, not a fill, and in ember rather than ink.

### 9.9 Floating action button

56 × 56px, radius 16px, `ink` fill, `onInk` icon at 24px, `elevationMd`.
Position: 16px from right and bottom on mobile (clearing the bottom nav), 24px on tablet.
Hidden ≥1024px, where the same action lives as a primary button in the page header.

**Never** show a FAB and a prominent bottom CTA for the same action.

### 9.10 Modal and bottom sheet

| Property | Modal (≥768px) | Bottom sheet (<768px) |
|---|---|---|
| Radius | 16px | 24px top corners only |
| Padding | 24px | 20px |
| Max width | 520px | full width |
| Elevation | `elevationLg` | `elevationLg` |
| Scrim | `scrim` | `scrim` |
| Drag handle | — | 36 × 4px, radius 999px, `borderStrong` |

Behaviour: closes on scrim click and on `Escape`; focus is trapped while open and returns to the trigger on close; the action row is `[Cancel] [Primary]`, each `flex: 1` on mobile.

### 9.11 Toast

Radius 8px, padding 12px 16px, `ink` background, `onInk` text, Lexend 14/500, `elevationLg`.
Centered horizontally; 160px from the bottom on mobile (above nav and FAB), 32px on desktop.
Auto-dismiss at 2.2s. `role="status"`, `aria-live="polite"`.
Toasts confirm; they never carry the only copy of an error.

### 9.12 Empty state

Centered, 40px vertical padding: 56px icon well (`raised`, radius 12px) → Space Grotesk H3 → caption capped at 38ch → one secondary button.
Say what will appear here and give the action that creates the first one.

### 9.13 Meter

6px height, radius 999px, `raised` track, `ember` fill.
Always paired with a text value — the bar is the glance, the number is the answer.
`role="img"` with an `aria-label` stating the value in words.

### 9.14 Toggle

| Property | Value |
|---|---|
| Track | 40 × 22px, radius 999px |
| Knob | 18px circle, `onColor`, `elevationSm`, 2px inset |
| Off | track `borderStrong` |
| On | track `ember`, knob translates 18px |
| Transition | 140ms ease |
| Row | wrapped in a 44px-min-height label row for the touch target |

A toggle on is a state you have selected, so the track is ember. Markup is `role="switch"` with `aria-checked`; the visible label sits beside it, never inside.

### 9.15 Data table

The densest surface in the product, and where the three-role model earns its keep.

| Property | Value |
|---|---|
| Container | `surface`, 1px `border`, radius 16px, `overflow: hidden` |
| Header cell | Lexend 13px / 500, `textSecondary`, padding 12px 16px, 1px `border` beneath |
| Body cell | Lexend 14px / 400, `textPrimary`, padding 12px 16px |
| Row separator | 1px `divider`; last row none |
| Row hover | `raised` |
| Row selected | `emberTint` background + `inset 3px 0 0 ember` on the first cell |
| Numeric column | right-aligned, `tabular-nums` |
| Min table width | 760px, inside an `overflow-x: auto` wrapper |
| Checkbox column | 44px fixed |

**Rules**

- The horizontal scroll lives on the table wrapper, never on the page body.
- Every table carries a `<caption>` (visible or screen-reader-only) saying what the rows are and how they are ordered.
- Selection is ember; status is a pastel chip. A row can be both selected and failing, and both must stay readable.
- Rating figures pair the `rating` star with the numeral — the star is 2.2:1 and cannot carry the value alone.

### 9.16 Pagination

| Property | Value |
|---|---|
| Button | min-width 32px, height 32px, radius 6px, Lexend 13px / 500 |
| Rest | `textSecondary` |
| Hover | `raised`, `textPrimary` |
| Current | `ember` fill, `onColor` text, weight 600 |
| Disabled | `textDisabled`, `not-allowed` |
| Ellipsis | `aria-hidden`, not focusable |

Current page is `aria-current="page"`. Previous/next carry `aria-label`s, not just glyphs.

### 9.17 Bulk-action bar

Appears when one or more rows are selected; floats over the content.

| Property | Value |
|---|---|
| Container | `surface`, 1px `border`, radius 12px, `elevationLg`, `width: fit-content` |
| Padding | 8px 12px |
| Count | Lexend 13px / 600, followed by a 1px `divider` rule |
| Action | 32px height, radius 6px, `textPrimary`, hover `raised` |
| Destructive action | `errorText`, hover `errorSubtle` |
| Dismiss | trailing ✕ with `aria-label="Clear selection"` |

The count is stated in words ("2 selected"), never as a bare number — it is the only thing telling the user how much their next click will affect.

---

## 10. Data visualization

Charts default to ink and spend color only on the point being made.

| Role | Token |
|---|---|
| Primary series | `textPrimary` line, `raised` area fill |
| Emphasis / current period | `ember` |
| Informational series | `link` on `infoSubtle` |
| Positive series | `success` on `successSubtle` |
| Attention series | `warning` on `warningSubtle` |
| Grid, axis | `divider` |
| Axis labels | `textSecondary`, Lexend 12px |

**Rules**

- Chart colors come from tokens, so charts follow the theme automatically. Never hard-code a hex in SVG.
- Sparklines: 2px stroke, round caps, endpoint dot at the final value.
- Every axis label names a value the chart actually reaches.
- Leave room in the `viewBox` for outermost labels; give every drawn shape an explicit fill.
- Bar sets follow the reference: neutral ink bars with a single `ember` bar for the current period. One highlighted bar reads faster than a full colour ramp.
- Categorical ramp, if a chart genuinely needs one (max 5):
  `#18181B` · `#4F5AC7` · `#F4511E` · `#1E8E3E` · `#C08A1E`

---

## 11. Interaction states

Every interactive element implements all applicable states.

| State | Requirement |
|---|---|
| Default | Resting appearance |
| Hover | Desktop only; background or border shift, never a size change |
| Pressed | Darker (light theme) or lighter (dark theme) fill |
| Focus | 2px `ember` outline, 2px offset, 8px radius — visible on every theme and every surface |
| Selected | `emberTint` wash + `ember` rule (rows), `ember` fill (checkbox, page, toggle), or ink fill (filter chip) — always with `aria-selected` / `aria-current` / `aria-checked` |
| Disabled | Reduced contrast, `cursor: not-allowed`, `aria-disabled`, removed from tab order |
| Loading | Inline spinner, dimensions locked, label retained |
| Error | Border, message, and icon — three signals |

**Transitions:** 120ms ease for color and background; 180ms ease for scrim and sheet. Nothing longer than 200ms in a productivity UI.

All motion is wrapped:

```css
@media (prefers-reduced-motion: reduce) {
  * { transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
```

---

## 12. Layout and responsive

| Breakpoint | Width | Change |
|---|---|---|
| Base | <640px | Single column, bottom nav, FAB |
| sm | ≥640px | Note grid → 2 columns |
| md | ≥768px | Page padding 24px, top bar 64px, icon buttons 44px, modal centers |
| lg | ≥900px | Stat grid → 4 columns |
| xl | ≥1024px | Sidebar appears, bottom nav and FAB hide, split layout activates |
| 2xl | ≥1100px | Page padding 32px |
| 3xl | ≥1280px | Note grid → 3 columns |

**Page**

| Property | Value |
|---|---|
| Max content width | 1280px, centered |
| Padding | 16px → 24px (768) → 32px (1100) |
| Bottom padding | 112px mobile (clears nav + FAB), 48px desktop |

**Split layout:** `1.6fr / 1fr` above 1024px, 24px gap. Main content left, context and summary right.

Never stretch content indefinitely on wide screens.

---

## 13. Accessibility

Target: **WCAG 2.1 AA.**

**Color and contrast**

- Body text ≥ 4.5:1. Large text (≥18.66px bold / ≥24px) ≥ 3:1.
- UI component boundaries and state indicators ≥ 3:1.
- `ember`, `warning`, `success` and `textDisabled` are below 4.5:1 by design — never use them for small text conveying information. Their `*Text` counterparts exist for exactly that.

**Targets**

- Minimum 44 × 44px. Where a control is visually smaller (22px checkbox), the row provides the target.

**Keyboard**

- Everything interactive is reachable and operable by keyboard.
- Focus is always visible: 2px `ember`, 2px offset.
- Modals trap focus and return it to the trigger on close.
- `Escape` closes any overlay.

**Screen readers**

- Semantic elements first; ARIA only to fill gaps.
- `aria-current="page"` on active navigation; `aria-selected` on tabs; `aria-pressed` on toggle chips.
- Decorative icons `aria-hidden="true"`; icon-only buttons carry `aria-label`.
- Toasts `role="status"`, `aria-live="polite"`.
- Meters `role="img"` with a spoken label.

**Independent of color**

- Status chips carry words.
- Completed tasks carry line-through.
- Errors carry an icon and a message.
- Charts carry labels, not just series colors.

**Motion**

- `prefers-reduced-motion` honored globally.

---

## 14. UX copy

- Write from the user's side of the screen. "Notifications", not "webhook config".
- Active voice. Controls say what happens.
- Confirmations mirror the action: "Publish" → "Published".
- Errors name the fix.
- Empty states say what will appear and how to create the first item.
- Numbers get units and context: "12 of 19", not "63%" alone.
- Sentence case everywhere except the eyebrow, which is uppercase by style.
- No exclamation marks in system messages.

---

## 15. Implementation

### 15.1 CSS custom properties

Declare the complete light palette on bare `:root`, then redefine **only** the tokens in each dark block. Never define a color for the first time inside a media or `[data-theme]` block.

```css
:root{
  /* Ink — creates */
  --ink:#18181B; --ink-hover:#27272A; --ink-pressed:#09090B;
  --ink-disabled:#D4D4D8; --on-ink:#FFFFFF;
  --on-color:#FFFFFF;              /* text on any saturated fill, both themes */

  /* Ember — marks selection and attention */
  --accent:#F4511E;                /* 3.5:1 — UI marks only, never small text */
  --accent-hover:#DC4517; --accent-pressed:#C23C13;
  --accent-subtle:#FEF0EA;         /* chip / callout fill */
  --accent-tint:#FDF6F3;           /* selected row wash */
  --accent-text:#C0400F;           /* 4.7:1 on accent-subtle */

  /* Link — informs */
  --link:#4F5AC7; --link-hover:#3F49AB;
  --info-subtle:#EEF0FC; --info-text:#4148A8;

  /* Neutral ramp — pure grey, no hue bias */
  --canvas:#F7F7F8; --surface:#FFFFFF;
  --raised:#F4F4F5; --raised-hover:#EBEBED;
  --border:#EAEAEC; --border-strong:#D4D4D8; --divider:#F0F0F1;
  --text-primary:#18181B; --text-secondary:#71717A;
  --text-disabled:#A1A1AA; --icon-default:#3F3F46;

  /* Status */
  --success:#1E8E3E; --success-subtle:#E7F4EB; --success-text:#177334;
  --warning:#C08A1E; --warning-subtle:#FDF3E0; --warning-text:#96690F;
  --error:#D14343;   --error-hover:#B63838;
  --error-subtle:#FDECEC; --error-text:#B03535;
  --rating:#F5A623;

  /* Utility */
  --scrim:rgba(24,24,27,.5);
  --e-sm:0 1px 3px rgba(24,24,27,.06);
  --e-md:0 4px 12px rgba(24,24,27,.10);
  --e-lg:0 12px 32px rgba(24,24,27,.16);

  /* Type */
  --font-display:'Space Grotesk','Inter',-apple-system,"Segoe UI",sans-serif;
  --font-body:'Lexend','Inter',-apple-system,"Segoe UI",Roboto,sans-serif;

  /* Radius */
  --r-xs:6px; --r-sm:8px; --r-md:12px;
  --r-lg:16px; --r-xl:20px; --r-2xl:24px; --r-pill:999px;

  /* Spacing */
  --s1:4px;  --s2:8px;  --s3:12px; --s4:16px; --s5:20px;
  --s6:24px; --s7:28px; --s8:32px; --s10:40px; --s12:48px;
}

/* System dark — must not beat an explicit light choice */
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --ink:#FAFAFA; --ink-hover:#FFFFFF; --ink-pressed:#E4E4E7;
    --ink-disabled:#3F3F46; --on-ink:#18181B; --on-color:#FFFFFF;
    --accent:#FF6B3D; --accent-hover:#FF8459; --accent-pressed:#E2542A;
    --accent-subtle:#2E1810; --accent-tint:#1F1310; --accent-text:#FF9068;
    --link:#8B94E8; --link-hover:#A5ACF0;
    --info-subtle:#1D2040; --info-text:#A3AAF0;
    --canvas:#0C0C0D; --surface:#141416;
    --raised:#1D1D20; --raised-hover:#26262A;
    --border:#27272A; --border-strong:#3F3F46; --divider:#1F1F22;
    --text-primary:#FAFAFA; --text-secondary:#A1A1AA;
    --text-disabled:#71717A; --icon-default:#D4D4D8;
    --success:#3FA65C; --success-subtle:#102416; --success-text:#6FCB8D;
    --warning:#D9A13A; --warning-subtle:#2A2010; --warning-text:#E8BC63;
    --error:#E06A6A;   --error-hover:#EC8585;
    --error-subtle:#2E1818; --error-text:#F09090;
    --rating:#F5B342;
    --scrim:rgba(0,0,0,.7);
    --e-sm:0 1px 3px rgba(0,0,0,.5);
    --e-md:0 4px 12px rgba(0,0,0,.55);
    --e-lg:0 12px 32px rgba(0,0,0,.65);
  }
}

/* Explicit toggle — same overrides, so it wins in both directions */
:root[data-theme="dark"]{ /* …identical overrides… */ }
```

**Three theme states, not two.** An explicit choice stamps `data-theme` on the root; the default "system" setting stamps nothing. Most users are in the un-stamped state, where only `prefers-color-scheme` applies. All three must resolve to a complete palette.

`body` must set an explicit token background — a transparent body borrows the host's ground and produces one theme's text on the other theme's background.

**Charts read from tokens too.** Style SVG through classes, never `fill="#F4511E"`, so a chart follows the theme with no JavaScript:

```css
.spark .line{stroke:var(--viz-stroke)}
.spark .area{fill:var(--viz-fill)}
.v-ink  {--viz-stroke:var(--text-primary); --viz-fill:var(--raised)}
.v-ember{--viz-stroke:var(--accent);       --viz-fill:var(--accent-subtle)}
```


### 15.2 Tailwind

```js
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        ink:     { DEFAULT:'var(--ink)', hover:'var(--ink-hover)',
                   pressed:'var(--ink-pressed)', disabled:'var(--ink-disabled)',
                   on:'var(--on-ink)' },
        ember:   { DEFAULT:'var(--accent)', hover:'var(--accent-hover)',
                   pressed:'var(--accent-pressed)', subtle:'var(--accent-subtle)',
                   tint:'var(--accent-tint)', text:'var(--accent-text)' },
        link:    { DEFAULT:'var(--link)', hover:'var(--link-hover)' },
        info:    { subtle:'var(--info-subtle)', text:'var(--info-text)' },
        canvas:'var(--canvas)',
        surface:'var(--surface)',
        raised:  { DEFAULT:'var(--raised)', hover:'var(--raised-hover)' },
        line:    { DEFAULT:'var(--border)', strong:'var(--border-strong)',
                   divider:'var(--divider)' },
        content: { DEFAULT:'var(--text-primary)', secondary:'var(--text-secondary)',
                   disabled:'var(--text-disabled)' },
        success: { DEFAULT:'var(--success)', subtle:'var(--success-subtle)',
                   text:'var(--success-text)' },
        warning: { DEFAULT:'var(--warning)', subtle:'var(--warning-subtle)',
                   text:'var(--warning-text)' },
        danger:  { DEFAULT:'var(--error)', hover:'var(--error-hover)',
                   subtle:'var(--error-subtle)', text:'var(--error-text)' },
        rating:'var(--rating)',
        oncolor:'var(--on-color)',
      },
      fontFamily: {
        display:['Space Grotesk','Inter','sans-serif'],
        sans:['Lexend','Inter','sans-serif'],
      },
      borderRadius: {
        xs:'6px', sm:'8px', md:'12px', lg:'16px', xl:'20px', '2xl':'24px',
      },
      boxShadow: { sm:'var(--e-sm)', md:'var(--e-md)', lg:'var(--e-lg)' },
    },
  },
}
```

Because every value is a CSS variable, theming needs no `dark:` variant on components.

### 15.3 Figma variables

Mirror the token names in a single collection with **Light** and **Dark** modes:

```
color/ink/default · hover · pressed · disabled · on
color/ember/default · hover · pressed · subtle · tint · text
color/link/default · hover
color/info/subtle · text
color/surface/canvas · surface · raised · raised-hover
color/line/border · border-strong · divider
color/content/primary · secondary · disabled
color/status/success · success-subtle · success-text
color/status/warning · warning-subtle · warning-text
color/status/error · error-subtle · error-text
color/status/rating
color/util/on-color
```

Number variables for `radius/*` and `space/*`. Text styles named for the scale rows in §4.2. Components bind to variables only — no raw hex on any layer.

### 15.4 Naming conventions

- Tokens: `category/role/state` — `color/ember/hover`.
- Never name a token for its value (`orange-500`); name it for its job (`ember`, `border-strong`).
- Component props follow the variant names in §9: `variant="primary" | "ember" | "secondary" | "outline" | "tertiary" | "destructive"`.

---

## 16. Do and don't

### Do

- Use ink for the one primary action per view.
- Keep the neutral ramp free of hue bias across all eleven steps.
- Give categories a neutral chip and a colored dot.
- Reserve filled status chips for things that need attention.
- Separate resting surfaces with borders.
- Set titles in Space Grotesk and everything read in Lexend.
- Adjust tracking per face, not per size.
- Author the dark ramp independently.
- Pair every color signal with a word or a shape.
- Keep every spacing value on the 4px grid.

### Don't

- Don't give a fourth job a fourth color — ink creates, ember marks, indigo informs.
- Don't introduce a hue bias into the neutral ramp — it kills ember's stand-out.
- Don't fill every chip with color.
- Don't put a shadow on a resting card.
- Don't set Space Grotesk in body copy, buttons, or table data.
- Don't use `ember`, `warning`, `success` or `textDisabled` for small informational text.
- Don't invert the palette for dark mode.
- Don't use pill radius on anything that isn't a chip, tag, dot, meter, or avatar.
- Don't ship a state that is signalled by color alone.
- Don't make a secondary action visually stronger than the primary.
- Don't put a FAB and a bottom CTA on the same action.
- Don't hard-code a hex anywhere, including inside SVG.

---

## 17. Governance

**Adding a token.** New tokens need a stated job that no existing token covers, values for both themes, and a contrast check against every surface they can land on.

**Adding a component.** Compose from existing primitives first. A new component needs: anatomy, all states from §11, both themes, keyboard behaviour, and an accessibility note.

**Changing a token.** Semantic and neutral tokens are contracts — changing a value changes every screen. Version the change and note it below.

**Review checklist**

- [ ] No hard-coded colors, including in SVG
- [ ] All spacing on the 4px grid
- [ ] Both themes verified, plus the un-stamped system state
- [ ] Focus visible on every interactive element
- [ ] Touch targets ≥ 44 × 44px
- [ ] No state signalled by color alone
- [ ] Space Grotesk confined to titles
- [ ] Contrast measured, not assumed
- [ ] One primary action per view

### Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-09-07 | Initial system. Warm Graphite direction; Space Grotesk + Lexend pairing. |
| 2.0 | 2026-09-07 | Re-based on the reference dashboard: three-role model (ink creates / ember marks / indigo informs), pure-grey neutral ramp replacing the warm one, pastel status family, data-table and pagination components added. |
