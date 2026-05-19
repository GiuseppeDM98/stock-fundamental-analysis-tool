# Product

## Register

product

## Users

Self-directed retail investor who dedicates part of their portfolio to active stock picking. Not a professional — they understand DCF and P/E ratios but don't have Bloomberg. They move through two distinct modes in the same session:

- **Discovery mode**: they don't have a ticker yet. They're looking for new investment ideas, asking the AI to surface quality compounders, undervalued dividend payers, or sector opportunities. They want a short list of candidates with a reasoning they can interrogate.
- **Analysis mode**: they have a ticker and a question ("is this cheap enough to buy?"). They want a confident, structured answer: fair value estimate, risk/reward setup, and a clear next step (buy now, watch for a better price, or pass).

In both modes, they want precision and calm, not reassurance and hype. They trust a tool that admits uncertainty more than one that always says "strong buy."

## Product Purpose

A stock picking pipeline for the self-directed investor: from AI-assisted idea discovery, through side-by-side screening, to fundamental analysis and a deliberate buy/watch/pass decision. It replaces scattered spreadsheets, paywalled data tools, and disjointed research tabs with a single, opinionated workflow.

The pipeline has four stages:
1. **Discover** — AI conversation surfaces new investment candidates from the investor's criteria (sector, quality metrics, valuation setup).
2. **Screen** — Side-by-side AI fair value comparison for 2–5 tickers narrows the shortlist.
3. **Monitor** — Tickers that aren't cheap enough today go to a personal watchlist with price alerts and bi-monthly re-analysis.
4. **Decide** — For tickers ready to act on, a deep fundamental analysis (DCF/DDM/EV/EBITDA + AI report) ends with a clear decision panel: add to portfolio, add to watchlist, or compare further.

Success means the investor ends each session with either a position opened, a ticker added to the watchlist with a justified buy target, or a deliberate "pass" — never just a tab closed with a half-read report.

## Brand Personality

Precise. Analytical. Calm.

The tool projects quiet competence — serious enough to trust with real money decisions, approachable enough that a non-professional isn't intimidated. It does not hype, celebrate, or gamify. When the data is bad, it says so plainly. When the price is right, it says so without fanfare.

## Anti-references

- **Generic SaaS dashboards**: indigo sidebars, identical white stat-card grids, generic sans-serif everything, off-the-shelf Tailwind component kits. The visual equivalent of "we use a lot of data."
- **Old Bloomberg / Reuters terminals**: maximum data density with zero visual hierarchy. Every pixel occupied, no breathing room, illegible at a glance.
- **Crypto / Robinhood apps**: neon accents, green-number animations, gamified progress, confetti. Energy and hype over signal.
- **Fintech marketing pages**: gradient text, hero animations, stock-photo money imagery, abstract blob backgrounds.
- **Research aggregators (Seeking Alpha, Motley Fool)**: opinion-heavy, ad-laden, no quantitative backbone. The tool provides structure and computation; it is not a content feed.

## Design Principles

1. **Signal over decoration** — Every visual element earns its place by carrying information or creating usable structure. Ambient glow, motion, and color must justify themselves against a skeptic.
2. **Confident sparsity** — Precision tools don't need visual reassurance. Whitespace is a deliberate feature; density is earned by data quantity, not applied as a default.
3. **Hierarchy through weight, not color** — Typography scale and weight shoulder the structural load. Color is reserved for semantic state: success, warning, danger, active. Never for decoration.
4. **Expert defaults, learnable details** — Labels are precise (DCF, WACC, EV/EBITDA), not softened. Educational modals exist for the curious, but the primary UI doesn't hand-hold.
5. **Calm under complexity** — When screens are data-dense (scenario panels, AI reports, charts), layout and whitespace are the primary stress-reducers. Avoid compounding visual complexity with ornament.
6. **Actionable at every step** — Every analysis must lead somewhere. A completed deep analysis offers three exits: buy, watch, or compare. A watchlist row offers two: analyze or compare. A compare result offers two: watch or deep-analyze. Dead ends — pages where the investor has to manually figure out what to do next — are a failure state.

## Accessibility & Inclusion

Standard best practices: reasonable color contrast (targeting WCAG AA for text), keyboard navigability, semantic HTML elements, visible focus states. No specific WCAG level formally required. Reduced-motion media query should suppress non-essential animations.
