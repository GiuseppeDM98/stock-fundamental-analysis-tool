---
name: Stock Fundamental Analysis Tool
description: A precision investment analysis workbench for self-directed investors.
colors:
  abyssal-navy: "#0a101f"
  void-deep: "#070d19"
  midnight-surface: "#121a2b"
  signal-blue: "#38bdf8"
  slate-mist: "#7b8ba9"
  emerald-positive: "#22c55e"
  amber-caution: "#f59e0b"
  rose-negative: "#ef4444"
typography:
  display:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Manrope, ui-sans-serif, system-ui"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Manrope, ui-sans-serif, system-ui"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.075em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "12px"
  md: "20px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.abyssal-navy}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.abyssal-navy}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.slate-mist}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  button-ghost-hover:
    backgroundColor: "transparent"
    textColor: "#f1f5f9"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  input-text:
    backgroundColor: "rgba(15, 23, 42, 0.7)"
    textColor: "#f1f5f9"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.midnight-surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
---

# Design System: Stock Fundamental Analysis Tool

## 1. Overview

**Creative North Star: "The Investor's Ledger"**

This system carries the quiet authority of a well-kept financial document. Not a dashboard, not a trading terminal: a ledger. Data arrives structured and complete. The layout is dense when the data demands it (scenario panels, chart rows, AI reports) and spacious when the information is sparse (auth pages, empty states). Whitespace is not a default; it is earned by what the content requires. The interface projects calm competence — serious enough to trust with real money decisions, approachable enough that a self-directed investor who is not a professional is not intimidated.

The palette is restrained by doctrine and committed by signature. The dark neutrals (Abyssal Navy, Midnight Surface) recede completely; they are not a theme, they are the absence of a theme, creating the condition for Signal Blue to do its work. Signal Blue is the single chromatic commitment: it marks interactive controls, accents the current price (the number the investor came to see), and traces the ambient glow under every card surface. Semantic colors (Emerald Positive, Amber Caution, Rose Negative) are strictly state signals: they name the condition of a position, a scenario, or a trend. They do not decorate.

The type pairing (Space Grotesk for structure, Manrope for reading) mirrors the tool's dual register: Space Grotesk sets the numbers and headings in confident geometric clarity; Manrope carries the body of AI reports and scenario labels in warm legibility. Neither font is generic; together they read as a considered choice, not a library default.

**Key Characteristics:**
- Dark-first: the investor arrives in the evening, at a desk, in focused analysis mode. Dark is forced by the scene, not the category.
- Tonal depth: three background tones (void-deep, abyssal-navy, midnight-surface) create layering without shadows on non-card surfaces.
- Signal Blue as anchor: the one saturated color is rare by design, powerful by rarity.
- Glow as signature: the sky-blue ambient shadow under cards is the single permitted decorative commitment. It renders the card as an illuminated surface, not a floating panel.
- Uppercase labels as structure: `text-xs font-semibold uppercase tracking-wider` labels divide every card into named sections, performing the role that dividers and rules would play in a printed document.

## 2. Colors: The Ledger Palette

A dark neutral field with a single chromatic anchor and three semantic state signals. The palette answers one question per color; it never answers the same question twice.

### Primary
- **Signal Blue** (`#38bdf8`): The chromatic anchor. It appears on the primary action button, the current market price, nav brand link, input focus ring, card ambient glow. Its rarity on any given surface is deliberate: when it appears, it commands attention.

### Neutral
- **Abyssal Navy** (`#0a101f`): The body background. It is not black. A faint blue cast makes dark elements read against it without borders.
- **Void Deep** (`#070d19`): The deepest surface, used for the navigation bar (with 80% opacity + blur) and the body gradient origin. Never used as a default background; reserved for the lowest elevation layer.
- **Midnight Surface** (`#121a2b`): The card background. Sits one step above Abyssal Navy, creating depth through tone rather than shadow.
- **Slate Mist** (`#7b8ba9`): The muted text color. Metadata, secondary labels, placeholder text. Reads at conversational volume, not headline volume.

### Semantic (State-Only)
- **Emerald Positive** (`#22c55e`): Positive P&L, bull scenario borders, upward trend indicators, favorable fundamentals. Never decorative.
- **Amber Caution** (`#f59e0b`): Warning states, caution indicators, mixed signals.
- **Rose Negative** (`#ef4444`): Negative P&L, bear scenario borders, downward trends, errors, danger states. Never decorative.

### Named Rules

**The One Voice Rule.** Signal Blue appears on at most 15% of any given screen surface. Its rarity is the point: when the price renders in Signal Blue and the Analyze button glows against the dark field, those elements command instant attention precisely because nothing else competes.

**The State-Only Rule.** Emerald Positive, Amber Caution, and Rose Negative are semantic, not stylistic. They name the condition of a data point. Using them for decorative elements (section headers, illustration fills, button variants that do not carry that state meaning) is prohibited.

**The Tonal Depth Rule.** Background depth is created by tone (void-deep → abyssal-navy → midnight-surface), not by shadow. Shadows are reserved for cards (the glow covenant) and modal overlays. Flat non-card surfaces do not carry shadows.

## 3. Typography

**Display Font:** Space Grotesk (with ui-sans-serif, system-ui fallback)
**Body Font:** Manrope (with ui-sans-serif, system-ui fallback)

**Character:** Space Grotesk is geometric and confident with a slight industrial edge — the right register for prices, company names, and page titles that need to read as authoritative numeric instruments. Manrope is warm and humanist, making dense AI analysis reports and scenario labels readable under extended focus. They share a neutral sans-serif skeleton but have opposite personalities, creating natural hierarchy without relying on color contrast alone.

### Hierarchy

- **Display** (700 weight, `clamp(1.875rem, 4vw, 2.25rem)`, line-height 1.1, letter-spacing -0.01em): Page-level headings. Currently one per page (the tool title in the dashboard hero). Space Grotesk. Rare.
- **Headline** (700 weight, `1.5rem`, line-height 1.2): Company name in the Market Snapshot card. Space Grotesk. One per analysis session, not per page section.
- **Title** (700 weight, `1.875rem`, line-height 1.1): The current market price; the number the investor came to see. Space Grotesk, Signal Blue. The one number with Signal Blue applied at headline weight.
- **Body** (400 weight, `0.875rem`, line-height 1.6): All prose in AI analysis reports, scenario parameter descriptions, general content. Manrope. Line length capped at 72ch.
- **Label** (600 weight, `0.75rem`, letter-spacing 0.075em, uppercase): Section labels above card content (e.g., "MARKET SNAPSHOT", "TICKER", "BULL SCENARIO"). Manrope. Slate Mist color. Performs the structural role of a printed document's column header.

### Named Rules

**The Label Doctrine.** Every card section opens with a `text-xs font-semibold uppercase tracking-wider text-muted` label. This is the primary structural element: it tells the investor what register of information they are about to read before they read the data. Labels are in Slate Mist; they recede so the data below them can advance.

**The Weight Ceiling.** 700 is the heaviest weight used. No `font-black` (900). Heavy weight competes with Signal Blue for attention. The hierarchy is weight + size, not weight alone.

## 4. Elevation

This system uses a hybrid elevation model: tonal layering for surface hierarchy, a signature accent glow for interactive card surfaces, and a dark overlay for modal overlays.

The tonal stack (void-deep → abyssal-navy → midnight-surface) handles most depth decisions without shadows. Cards break from this convention by design: the ambient Signal Blue glow (`0 10px 40px -20px rgba(56, 189, 248, 0.45)`) lifts each card from the background, reads as an illuminated surface in the dark field, and is the system's single decorative commitment at the structural level.

### Shadow Vocabulary

- **Card Glow** (`box-shadow: 0 10px 40px -20px rgba(56, 189, 248, 0.45)`): Applied to every `.card` surface. The glow references Signal Blue at low opacity, creating ambient luminance rather than a hard drop shadow. It is always on — it does not respond to hover or focus.
- **Modal Overlay** (`box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25)`): Applied to modal panels (`shadow-2xl`). Neutral dark shadow; no accent color. Modals use background tint (`bg-black/75 backdrop-blur-sm`) for the scrim, not additional shadows.
- **Flat Rule**: Navigation bar, scenario input rows, chart containers, page-level sections carry no shadow. They rely on borders (`border-slate-800/60`) and background tones for separation.

### Named Rules

**The Glow Covenant.** The Signal Blue card glow is the single permitted decorative shadow. It does not appear on buttons, inputs, nav, or inline elements. New card-like surfaces inherit it. Non-card surfaces do not receive it, even for emphasis.

**The Flat-First Rule.** Every non-card surface is flat at rest. Depth is earned by card status. If a surface is not a card (does not use the `.card` class or equivalent), it does not carry a box-shadow under any state.

## 5. Components

### Buttons

Clean, typed, low-chrome. The primary button is Signal Blue on Abyssal Navy text — a high-contrast inversion that reads as an active instrument, not a decorative CTA.

- **Shape:** Gently curved (12px radius). Not pill-shaped; not square. The rounding signals "interactive" without softening the data-tool register.
- **Primary** (`bg-signal-blue text-abyssal-navy`): `padding: 8px 16px`, 600 weight, 0.875rem. Hover: `brightness(1.1)`. Disabled: 60% opacity, `cursor: not-allowed`. Focus: `box-shadow: 0 0 0 3px rgba(56,189,248,0.4)`.
- **Ghost / Secondary** (`border border-slate-700 text-slate-300`): `padding: 4px 12px`, 8px radius. Hover: `border-slate-500 text-slate-100`. Used for Sign Out, secondary actions that carry no affirmative weight.
- **Register CTA** (`bg-sky-500 font-semibold`): Nav-level register link. Slightly darker sky blue than Signal Blue, slightly more saturated. Shares the 8px radius with ghost buttons (nav context).

### Inputs / Fields

- **Style:** Dark glassy background (`rgba(15, 23, 42, 0.7)`), 1px border (`#334155`), 12px radius, 0.875rem Manrope body. Placeholder in Slate Mist.
- **Focus:** `box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.4)` + border shifts to Signal Blue. No label float; labels appear as uppercase line elements above the field.
- **Scenario inputs** (DCF parameter fields): Same border/bg treatment, smaller padding. Values always shown as percentages. The field's width is constrained to the data it holds.

### Cards / Containers

The primary container unit. Every data section is a card.

- **Corner Style:** Generously curved (16px radius). Rounds the ledger entry without softening it to a consumer product.
- **Background:** Midnight Surface (`#121a2b`), 70% opacity slate-800 border.
- **Shadow:** Card Glow (see Elevation). Always on. No hover variant.
- **Backdrop:** `backdrop-filter: blur(4px)` for subtle depth against the gradient background.
- **Internal Padding:** 20px (`p-5`). Consistent. The label + data stack inside the padding, not flush to the edge.
- **Scenario Variant Cards** (Fair Value Cards): inherit the base card, override the border with a scenario-colored border at 40% opacity (emerald-500/40 for bull, sky-500/40 for base, rose-500/40 for bear). Border carries the scenario signal; the interior layout is identical across variants.

### Chips / Badges

- **Source Badge** (Smart defaults, Generic defaults, Custom): `text-xs`, `border`, `rounded-full`, colored per source: emerald for smart, slate for generic, amber for custom. Uppercase label convention does not apply; these are inline annotation elements.
- **Sector Badge**: Same chip shape. The badge text is `[Sector · Method]`. Uses a muted border without the semantic color mapping.
- **Scenario Labels** (BULL / BASE / BEAR): `text-xs font-semibold uppercase tracking-wider text-muted` — same as section labels. Not colored; the card border does the scenario coloring.

### Navigation

The navigation bar is the darkest surface in the system, sitting below the card layer in perceived elevation.

- **Style:** Sticky, `border-b border-slate-800/60`, `bg-void-deep/80 backdrop-blur-md`. The 80% opacity + blur creates a frosted-glass effect that reads as the lowest opaque layer.
- **Brand link:** Signal Blue (`#38bdf8`), 600 weight, 0.875rem. The one instance of Signal Blue in the nav; it anchors the page identity.
- **Nav links:** Slate Mist at rest (`#94a3b8`). Fade to white on hover (`#f1f5f9`). No underline; no active indicator other than color shift.
- **Auth actions:** Ghost button (Sign Out) + Register CTA button share the nav height (`py-1`) to stay within the nav rhythm.

### Signature Component: Uppercase Section Label

Not a heading, not a caption: the section label is a structural element that divides card content into named registers.

- **Style:** `text-xs font-semibold uppercase tracking-wider text-slate-mist`. Always the first element in a card, separated from the data below by `margin-top: 12px`.
- **Purpose:** Performs the role of a printed column header or ledger section divider. It tells the investor the data category before they read the data. Never colored; never Bold above 600 weight; never larger than 0.75rem.

## 6. Pipeline Components

New component patterns introduced for the investment pipeline flow. All inherit the base design system (card glow, tonal depth, label doctrine, semantic color rules).

### Decision Panel

Appears at the bottom of the Deep Value panel after streaming completes (`result !== null`). Three actions side by side, each routing the investor to the next pipeline stage.

- **Layout**: `flex gap-2 pt-4 border-t border-slate-800/60 mt-4` — a flush row of three equal-width ghost buttons with distinct semantic icons.
- **Actions and semantic color**:
  - **"Add to Portfolio"** (`text-emerald-400 border-emerald-800/50 hover:border-emerald-600 hover:bg-emerald-900/20`): only shown when the analysis suggests the price is at or below buy target. Opens the AddPosition modal pre-filled with ticker + current price.
  - **"Add to Watchlist"** (`text-amber-400 border-amber-800/50 hover:border-amber-600 hover:bg-amber-900/20`): pre-fills watchlist with buy target from analysis. Shows "In Watchlist" chip (disabled, muted) when already tracked.
  - **"Add to Compare"** (`text-sky-400 border-sky-800/50 hover:border-sky-600 hover:bg-sky-900/20`): navigates to `/compare?tickers=X`, appending to any existing tickers.
- **Button shape**: same ghost-button base (8px radius, `0.8125rem` text, `6px 12px` padding), with a colored icon (`1rem`) left of label.
- **Rule**: Decision Panel buttons use semantic colors because the action itself carries that state meaning — portfolio = positive, watchlist = caution/holding pattern, compare = informational. This is the only permitted exception to the State-Only Rule for button backgrounds.

### Quick-Action Buttons (Inline Pipeline Routing)

Compact secondary buttons placed inline in table rows (Watchlist, Compare) and response messages (Advisor). They route the investor to the next pipeline stage without navigating away.

- **Style**: `text-xs font-medium py-1 px-2.5 rounded-md border border-slate-700/60 text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors` — understated, reads as metadata-level actions, not primary CTAs.
- **Placement**: always trailing in a row, never interrupting the data columns. Watchlist rows: rightmost column after Edit/Delete. Compare columns: stacked below the existing "Deep Analysis" button.
- **"Already added" state**: when a ticker is already in the target (watchlist item exists, ticker already in compare list), the button becomes a static chip: `text-xs text-slate-500 border border-slate-800 rounded-md px-2 py-1 cursor-default` with checkmark icon. No disabled styling — it reads as resolved, not blocked.
- **Label convention**: verb-only labels ("Watch", "Compare", "Analyze") — no articles, no "Add to". One word, or two when the verb alone is ambiguous.

### Price Proximity Badge

Appears in the Watchlist table, showing how far the current price is from the buy target as a percentage. Replaces the need for the investor to calculate this mentally.

- **Layout**: an inline pill chip in the "Distance" column: `text-xs font-semibold rounded-full px-2 py-0.5`.
- **States**:
  - **At target or below** (≤ 0%): `bg-emerald-500/15 text-emerald-400 border border-emerald-800/50` — "AT TARGET" label, no percentage shown. Signals an actionable opportunity.
  - **Close** (1–10% above target): `bg-amber-500/15 text-amber-400 border border-amber-800/40` — shows "+X% to target". Investor should start reviewing.
  - **Watching** (> 10% above target): `bg-slate-800/60 text-slate-400 border border-slate-700/50` — shows "+X% to target". Passive monitoring state.
- **Rule**: distance is computed as `(currentPrice - buyTarget) / buyTarget * 100`. When buyTarget is null (no saved analysis for ticker), the badge is omitted.

### Mode Toggle (Advisor: Portfolio / Discovery)

A tab-strip toggle at the top of the Advisor page, switching between the two advisor modes without a page navigation.

- **Style**: `inline-flex gap-0.5 bg-slate-900/60 border border-slate-800 rounded-lg p-0.5`. Each tab: `text-xs font-semibold px-4 py-1.5 rounded-md transition-colors`.
- **Active tab**: `bg-midnight-surface text-slate-100 shadow-sm` — the active surface rises one tonal step from the container.
- **Inactive tab**: `text-slate-500 hover:text-slate-300` — recedes, reads as navigation affordance not current context.
- **Labels**: "Portfolio" (portfolio icon) and "Discovery" (search/compass icon). Short, not "Portfolio Advisor" — the page title already establishes context.
- **Rule**: the toggle is a mode switch, not a filter. Switching mode resets the conversation input and suggested prompts. It does NOT reset conversation history (sessions from both modes are preserved in the sidebar).

### Advisor Ticker Chip (Split Action)

Extends the existing `[[TICKER]]` chip pattern in Advisor responses. Each chip now has two affordances.

- **Base chip**: `text-sky-400 font-mono text-xs bg-sky-900/20 border border-sky-800/50 rounded-md px-2 py-0.5 inline-flex items-center gap-1` — same as current clickable ticker chip.
- **Split button**: the chip divides into two zones with a `1px border-slate-700` divider:
  - Left zone (ticker label + arrow icon): navigates to `/?ticker=X` — current behavior, unchanged.
  - Right zone (graph/compare icon, `px-1.5`): appends ticker to the compare page URL and shows a toast notification "Added to Compare".
- **Hover state**: the hovered zone lightens (`bg-sky-900/40`); the other zone stays at rest. This makes the two affordances spatially distinct.
- **"Already in compare" state**: the right zone shows a checkmark icon in `text-slate-500`; no click behavior. Tooltip on hover: "Already in Compare".

## 7. Do's and Don'ts

### Do:
- **Do** open every card section with a `text-xs font-semibold uppercase tracking-wider text-muted` label. The label is structure, not decoration.
- **Do** use Signal Blue exclusively for interactive controls, the current price figure, the nav brand, and the card glow. Its value is its rarity.
- **Do** use Emerald Positive, Amber Caution, and Rose Negative only to indicate state: P&L direction, scenario type, trend direction, error conditions.
- **Do** let layout density respond to data density. An analysis page with 10 data sections is dense by necessity. An auth page with one form is spacious by necessity. Neither is wrong.
- **Do** use Space Grotesk (`font-display`) for prices, company names, page headings — any number or name that the investor comes to read first. Use Manrope (`font-body`) for everything else.
- **Do** express depth through tonal stepping: void-deep (nav) → abyssal-navy (page bg) → midnight-surface (card). Add the card glow; let everything else be flat.
- **Do** cap body text line length at 72ch. AI analysis reports are long; line length is the primary legibility control for extended reading.

### Don't:
- **Don't** use an indigo sidebar, white card background, or a generic stat-card grid. This tool is not a generic SaaS dashboard. Those choices signal "assembled from a component library," which undermines the instrument authority the system is built on.
- **Don't** recreate Bloomberg-style maximum data density with no visual hierarchy. Every screen has a primary number (usually price or fair value). That number gets Space Grotesk and, if it is the current price, Signal Blue. Everything else recedes.
- **Don't** use gradient text (`background-clip: text`). Signal Blue is a single solid color. It reads as precise because it is single-valued. A gradient makes it decorative.
- **Don't** apply the card glow to non-card surfaces (nav bar, inline elements, buttons, section dividers). The glow marks a card. If it appears elsewhere, it loses its structural meaning.
- **Don't** use Signal Blue, Emerald Positive, Amber Caution, or Rose Negative for decorative fills, illustration accents, or background tints unrelated to the data state they represent.
- **Don't** add a side-stripe border (`border-left` > 1px as a colored accent) to cards, alert banners, or list items. The scenario fair value cards use a full perimeter border in the scenario color; they do not use a stripe.
- **Don't** introduce glassmorphism cards decoratively. The backdrop blur on `.card` exists for depth against the gradient background, not as an aesthetic statement. New card surfaces should omit blur unless the context specifically requires it.
- **Don't** use green, amber, or red for anything other than the semantic states (P&L, trend, scenario type, error). A green button that is not confirming a positive-return action, a red badge that is not warning about a negative — these erode the semantic contract the investor relies on to scan results quickly.
