## ✨ New Features

- **Next-earnings calendar for your stocks** — know when a company next reports, so you know when to re-run its analysis. On the Saved Analyses, Watchlist, and Portfolio pages, each stock has a **"Find next earnings (AI)"** button that looks up the next results date via AI web search and remembers it (with the date it was fetched and a 🔄 to refresh). The Saved Analyses page lists all upcoming dates nearest-first in an "Upcoming earnings" strip, and shows an amber **"New data since last analysis"** nudge when a company has reported since you last analysed it — a clear signal it's time for a fresh look. Works for companies that report quarterly, half-yearly, or annually.

- **AI Deep Value analysis** — the core of the app. A single AI panel on `/analyze` produces a full equity-research report for any stock worldwide, including tickers where market data is incomplete. The AI autonomously picks the valuation method (DCF, DDM, EV/EBITDA, or P/B) based on the sector, sources all financial data via web search, and outputs Bull / Base / Bear fair values plus a structured report (Company Overview, Competitive Moat, Valuation Method, Key Financial Data & Quality Metrics, Bull/Base/Bear cases, Key Risks, Near-term Catalysts, Investment Summary). Available in 8 languages (EN, IT, ES, FR, DE, PT, ZH, JA).

- **Analyst Panel — three independent second opinions** — on any saved analysis, run up to three independent AI passes, each through a distinct lens: **Skeptic** (red-teams the numbers and assumptions), **Optimist** (builds the constructive bull case), and **Quality** (stress-tests the moat and long-term durability). Each lens commits to its own Bull/Base/Bear valuation and a written critique, run on demand from the saved-analysis page. Every lens that has run is shown next to the base analysis on the valuation ruler and comparison table, along with a **consensus** — the average across the base analysis and every lens that ran — so you can see at a glance how much (and in which direction) independent reviewers disagree. Results are saved with the analysis, shown in a distinct panel with a **✓ Reviewed** badge on the list card, regenerable anytime, and included in the PDF export. (Replaces the earlier single "Analyst Review" red-team pass — the Skeptic lens is that same review, now joined by two more perspectives.)

- **Margin of Safety & dual fair value** — set a Margin of Safety (0–80%) and the report shows both the intrinsic fair value (what the stock is worth) and the MoS-discounted buy target, for each Bear/Base/Bull scenario. A valuation recap table at the end of every report lists current price vs. fair values with upside/downside.

- **Download reports as PDF** — a **Download PDF** button on both a completed analysis and any saved analysis opens a clean print layout (navigation and buttons hidden, upside/downside and accent colors preserved) — choose "Save as PDF" to export.

- **AI Portfolio Advisor** — a conversational `/advisor` page with two modes. **Portfolio mode** knows your holdings, weighted average costs, and saved fair values, so you can ask "which of my positions has the most upside left?" **Discovery mode** starts clean and is purpose-built for finding new ideas — ask for quality compounders, undervalued dividend growers, or sector opportunities and get 3–5 concrete tickers with a thesis, ROIC, valuation setup, and key risk each. When the AI names a stock, it appears as a clickable chip that launches a Deep Value analysis. Conversations are saved and listed in a sidebar. Your selected mode is remembered.

- **See how your estimate evolved** — when you have more than one saved analysis for a ticker, the saved-analyses card shows an evolution panel tracing the % change at **every step across your full save history** (not just the latest vs. the previous one). Each step is a dated block with rows clearly labeled **Analysis** and **Consensus**, under a caption naming the metric (base fair value). It's a plain, exact calculation from your saved numbers — so you can watch the thesis strengthen or weaken over time at a glance.

- **Weak-signal indicator on valuations** — when a stock's Bull–Bear range is so wide that the gap between price and fair value falls inside the model's own uncertainty, a muted **"weak signal"** tag appears next to the Buy/Watch/Over verdict on Saved Analyses and the Watchlist. It's an honest heads-up that the verdict is low-confidence (common for volatile, commodity-driven names), computed purely from your saved Bull/Base/Bear values — and it stays quiet on high-conviction, tight-range stocks.

- **Adaptive Hub home** — the home page frames the full pipeline (Discover → Decide → Monitor) with a card per stage, a "Start with the Advisor" call-to-action, and a quick ticker box that jumps straight into an analysis. When logged in it surfaces a recent-activity strip: latest analyses, portfolio P&L, and watchlist count.

- **Portfolio Tracker** — track real purchases with live P&L at `/portfolio`. Supports EUR, USD, GBP, CHF, JPY, CAD, AUD, SEK, NOK, DKK with automatic FX conversion to EUR (via [Frankfurter API](https://api.frankfurter.app)). Positions for the same ticker are grouped into a single Weighted Average Cost (DCA) row with an expandable per-purchase breakdown, toggleable to a flat per-purchase view.

- **Close a position (full or partial sale)** — sell all or part of a holding directly from the portfolio, recording the sale price and date. Closed positions move to an archived "Closed positions" section showing realized profit/loss, while the P&L history chart marks the sale date with a violet "Sold" marker — so a drop in value or cost basis reads as a tracked sale, not an unexplained market crash. Selling part of a position splits it cleanly: the remainder keeps tracking live P&L as before, and the sold portion is archived with its own realized result.

- **Portfolio summary, redesigned** — the top of `/portfolio` now leads with your current value and unrealized P&L, followed by a compact ledger row of cost basis, realized P&L, total, and dividends received. The P&L history chart gained a legend.

- **Daily price change in Portfolio** — each position shows today's % and absolute move vs. the previous close, in green or red, next to the current price.

- **Capital gains tax & net P&L** — set an optional tax rate (%) per position and the portfolio shows estimated taxes and net P&L alongside the gross gain, both per position and in the summary bar (useful for the Italian 26% rate or any jurisdiction). Taxes are applied only to gains, never to losses.

- **Net P&L on realized gains** — closed positions now show estimated capital-gains tax and net profit alongside the gross realized P&L, both on each closed position card and in the portfolio summary bar — matching the gross/net treatment already available for open positions.

- **Dividend tracking** — add an ISIN to a position and dividends paid on Borsa Italiana are recorded automatically. The summary bar shows a cumulative "Dividends Received" total (gross and net when a tax rate is set), and the P&L history chart marks payment days with a green vertical line.

- **Portfolio P&L History chart** — a line chart of portfolio value vs. cost basis over time, captured automatically every weekday after market close. Amber vertical markers flag days you deployed new capital (new position or DCA); hover to see the amount.

- **Exit signal — "At Fair Value"** — when a holding's price reaches the intrinsic base fair value from your most recent saved analysis, an amber ⚠ At Fair Value badge appears in the position row with a Re-analyze → shortcut that runs a fresh, independent Deep Value analysis. The threshold is the point where your original margin of safety is fully consumed; use the Advisor afterwards to decide whether to hold, add, or exit.

- **Portfolio ↔ analyses cross-linking** — each position shows how many saved analyses exist for its ticker, expandable inline with date, MoS%, buy target and intrinsic value, and a link to the full report. Each saved analysis conversely shows an open-position badge with shares, WAC, and live P&L.

- **Watchlist, redesigned with a daily digest** — the watchlist is now a compact card per ticker, matching the saved-analyses page: expand a card for the same **valuation ruler** (buy/watch/rich zones, your fair value, one tick per analyst lens that ran, and the consensus) and a Fair value ↔ Buy target toggle, plus a BUY/WATCH/OVER verdict at a glance. The email digest now arrives **daily**, with a richer per-ticker layout: price, gap vs. your buy target, a Bear/Base/Bull breakdown split into Analysis / each analyst lens that ran / Consensus, your buy target, and the date of the underlying analysis. Each entry still has its own MoS% slider, a per-row **Analyze** button, and a price-proximity badge. Pause the digest without deleting the list, or trigger an update on demand (rate-limited to once per 24h).

- **Saved analyses, redesigned** — reports are grouped by ticker as compact cards showing the live price and a **Buy / Watch / Over-FV verdict** at a glance. Expand a card for a single **valuation ruler** that places the current price on the Bear→Bull range with clear buy / watch zones, your fair value, one tick per analyst lens that ran, and the consensus all marked on one axis (with their values), plus a compact comparison table you can flip between fair value and buy target. Metadata (performance, open-position P&L) and actions live in the expanded view; older analyses stay in a collapsible history. Search by ticker/name, filter to "Under FV", or sort by recent / ticker / performance. A performance badge shows `$priceAtSave → $priceNow ±X%`.

- **User accounts** — register with email and password to save reports, revisit them at `/analyses`, and re-run any analysis with one click (ticker pre-filled).

- **Language toggle (EN / IT)** — switch the entire interface, including number formatting, with one click. Your preference is remembered. AI report language defaults to your selection but can be overridden per report.

- **Installable app (PWA)** — install the app on your device. On Android, Chrome shows an "Install" banner; on iOS, use Share → Add to Home Screen. Once installed it opens in standalone mode with its own icon.

- **Choose your AI model** — a new settings menu (gear icon in the nav bar) lets you pick which AI model powers every analysis: Claude Opus 4.8, Claude Sonnet 5, or the new **DeepSeek V4 Pro** — plus a reasoning-effort level and thinking on/off, as your default across the app. Deep Value, the Advisor, and the Analyst Panel each also show an inline selector so you can override the default for a single run. DeepSeek is a lower-cost alternative; note it's noticeably slower than Claude on a full Deep Value analysis, since it takes many more research steps to gather the same data.

- **Earnings countdown in the watchlist digest** — if you've looked up a stock's next-earnings date (via the "Find next earnings (AI)" button on Saved Analyses, Watchlist, or Portfolio), the daily email now shows a countdown for it right on the ticker card: "results today," "N days until the next report," or, if you haven't refreshed it in a while, "N days since the expected date" — a nudge to update it.

- Added **Grounded Deep Value — paste your own financial data**. On `/analyze`, an optional "Pasted data" section lets you paste financial statements, historical valuation multiples, forward estimates, and peer comparables (from any source you like) instead of relying solely on the AI's own web search. Add each paste as a typed block — income statement, balance sheet, cash flow, multiples, estimates, or a peer — and hit **"Prepare data"** for a verifiable preview: currency and units, years covered, the historical multiple distribution (with a de-rating/re-rating trend), current peer multiples, and any data-quality warnings (a share count that jumped implausibly, a net-debt mismatch) — all before spending a full analysis run on it. Confirm to run the analysis grounded in your own numbers; web search is then reserved for anything more recent than your paste plus qualitative context (moat, risks, catalysts), never used to re-fetch what you already provided.

- Added a **deterministic "reality check" on every Grounded report**. After a Grounded analysis completes, a new **"Deterministic post-check"** card verifies the AI's own math: whether its bull/base/bear valuation bridge reconciles with the fair value it reported, whether your margin of safety was applied correctly, and — the key signal — whether its base-case valuation multiple happens to land suspiciously close to what the current price already implies, a sign the "fair value" might just be reverse-engineered from the price rather than independently derived.

- Added a **"blind commitment vs. final" view on Analyst Panel reviews** for Grounded analyses. Each reviewer (Skeptic, Optimist, Quality) now commits to its own Bull/Base/Bear valuation **before it ever sees your saved report**, then reconciles against it in a visible second pass. A new card shows both numbers side by side with the drift between them, plus the specific reason for any change — so you can tell whether a reviewer gave a genuinely independent second opinion or just converged on the report's own number. The card appears as soon as the reviewer's blind take is ready, while it's still working on the reconciliation.

- Added a **kill price to the Skeptic review**. Instead of only critiquing the report, the Skeptic now states the specific price below which it believes the investment thesis is dead — or explicitly says it couldn't construct one, which is itself a meaningful signal.

## 🐛 Bug Fixes

- Fixed the **PDF export from the analysis page including an app "screenshot"** as the first page (the search box, disclaimer, market-data header, and Margin of Safety slider). The PDF now starts cleanly at the report, matching the saved-analysis export.

- Fixed the **Analyst Review cutting off mid-sentence** on longer reviews — it now has far more room to work, and if it ever does reach the limit a clear "truncated" notice appears with a one-click **Re-run** to regenerate it.

- Fixed a **mislabeled bar on the saved analyses page** — the buy-target gradient bar read "Above/Under FV" when it actually represents your buy target. It now reads "Above/Under Buy Target" and is properly translated.

- Fixed **AI Advisor replies getting cut off mid-sentence** on longer answers — the length limit was too low for detailed Discovery responses. It has been raised substantially, and if a reply ever does hit the cap a clear "response truncated" notice now appears instead of the text simply stopping.

- Fixed **AI responses truncating during long streaming** — a service-worker issue could sever the connection on lengthy analyses (Advisor and Deep Value), cutting the response short. Streaming responses are now delivered reliably.

- Fixed the **Advisor suggesting stocks that are no longer traded** — it once recommended a company delisted years ago. The Advisor now verifies via web search that a ticker is currently listed and actively traded before recommending it.

- Fixed the **Advisor quoting a wrong, stale price** for a portfolio holding (e.g. showing ~2.28 for a stock actually trading at 2.16). The Advisor now receives the real current price of each of your holdings as authoritative ground truth, so its numbers match the live market.

- Fixed the **Advisor inventing reasons for a price move** — it would state a cause (a "vague guidance", a "fund rotation") as established fact without checking. It now must verify any cited cause, news, or event via a dated web search, or explicitly flag the driver as unconfirmed instead of guessing.

- Fixed **upside/downside percentages** in Deep Value being wildly understated (a base value 143% above price showed as "+1.4%") — they are now computed directly from fair value vs. the live price.

- Fixed the **Watchlist showing prices in dollars** for EUR-listed tickers that hadn't been analyzed yet — rows now use the live quote's actual currency.

- Fixed being **unable to delete a ticker's only or most recent saved analysis** — a delete button is now in each ticker's header, not only in the older-analyses history.

- Fixed the **analysis page always resetting to AAPL** instead of remembering the last ticker you viewed.

- Fixed the **recap table column header** showing "EUR Fair Value" when a Margin of Safety is set — it now correctly reads "EUR Buy Target (-X%)" since the values are MoS-adjusted (and stays "EUR Fair Value" at 0% MoS).

- Fixed the **Advisor confusing buy targets with intrinsic fair values** when discussing your saved analyses — it now receives both, clearly labeled, so its answers cite the right number.

- Fixed the portfolio summary showing "converted to EUR" **even when all positions are already in EUR** — the attribution now appears only when FX conversion actually happens.

- Fixed the **watchlist frequency label** always showing "Every 2 weeks" even when "Monthly" was selected.

- Fixed the **favicon** not appearing in browser tabs, including incognito mode.

- Fixed Deep Value reports showing intermediate "thinking" text before the actual report, and occasionally **anchoring to the wrong year** — reports now start cleanly and reflect the current date.

- Fixed the saved-analysis detail page and analyses previews not rendering markdown correctly (tables/headings, and a raw JSON block leaking into previews).

- Fixed a **crash on certain tickers** (some European stocks) that data providers return as unavailable — a clear error message is shown instead.

- Fixed the **home page's Portfolio P&L looking out of sync** with the live figure on `/portfolio` — the home value is a daily snapshot, so it's now labeled "as of &lt;date&gt;" to make that clear.

- Fixed the **estimated tax figure showing even when your overall unrealized P&L was a net loss** — a single profitable position no longer triggers a tax estimate that made no sense against a portfolio down overall.

- Fixed **AI reviews and analyses being cut off with a "too many search rounds" notice** when using the DeepSeek model — the research budget was raised and each web search now returns more, so DeepSeek runs complete far more often. (Analyses using Claude were never affected.)

- Fixed **an occasional stray non-Latin character** (e.g. a Chinese character) slipping into a report or review written in another language.

- Fixed **Analyst Panel reviews occasionally returning a silently incomplete or empty result** after a long web-search session — a rare pausing behavior in the underlying search is now handled correctly instead of cutting the review short partway through.

- Fixed **pasted financial data occasionally failing to extract** on the Grounded "Prepare data" step, especially on longer or more complex pastes.

- Fixed a **Grounded data-extraction issue** where net income and earnings-per-share could be read from two different reporting bases in the same year (e.g. "including" vs. "excluding" one-off items), occasionally triggering a false "EPS doesn't reconcile" warning.

## 🔧 Improvements

- **Deep Value analyses are more rigorous** — reports now incorporate the latest quarterly results (not just annual figures), verify that any cited guidance or business plan is the current version, separate official guidance from estimates, use normalized (recurring) earnings for valuation multiples, differentiate the Bull/Base/Bear scenarios on real fundamentals, and benchmark against the closest comparable companies rather than only large global peers. These directly address blind spots a second opinion used to catch.

- **Valuations resist anchoring to the current share price** — the analysis now derives its valuation multiple from the company's own history and closest peers *independently of the price*, and treats "what the market is already pricing in" as a cross-check that reports the gap, rather than the answer. Reports also deduct minority stakes correctly and vary them across each Bull/Base/Bear scenario, keep the scenario numbers internally consistent (net debt, ROE, share count), compare peers on the same accounting basis, and now end with explicit **"what would prove this thesis wrong"** conditions to watch at the next results.

- **Analyst reviewers are sharper and stay in their lane** — every lens now runs the same structural checks (the valuation bridge, sum-of-the-parts double-counting, peer comparability) that independent reviewers used to catch, and no longer issues a trade instruction more aggressive than the report it's reviewing (e.g. "buy at €X" when the report says hold).

- **Every analyst lens trusts the app's live price** — none of them second-guess a correct current price using stale quotes from the web, so each "above or below fair value" verdict is reliable.

- **Deep Value reports read like professional research** — clearer section dividers, consistent spacing and colors, and the exact same layout whether streaming live or opened from your saved history. The recap table collapses to stacked cards on narrow screens.

- **Deep Value analyses dig deeper** — they run at a higher reasoning effort with far more room to work, sourcing up to 5 years of financial data, so reports are more thorough and less likely to be cut short on complex companies.

- **Every analysis is independent of your position** — a Deep Value analysis (and every analyst-panel lens) is never told what you paid or what a previous run estimated, so its fair values can't be unconsciously anchored to your cost basis or nudged to justify holding. Reaching fair value is a checkpoint, not an automatic sell — take the fresh, unbiased numbers to the Advisor, which knows your holdings and can weigh hold / add / exit (including dividend considerations) for you.

- **Cleaner P&L presentation** — performance and P&L deltas appear as colored pill badges with a tinted background, and positions display as `shares × buy price → current price` with an inline P&L badge.

- **Fully responsive** — the app is optimized for phones and tablets: the navigation and Advisor sidebar become slide-in drawers, dense tables collapse into cards, and touch targets are finger-sized.

- **Navigation highlights the current page**, and form inputs show a visible focus ring for clearer keyboard navigation.

- **Quicker follow-on purchases in the Portfolio** — a new **"+ Purchase"** button on each holding opens the Add Position form pre-filled with that stock's name, currency, and ISIN, so buying more of something you already own no longer means retyping it from scratch (and risking a typo that would otherwise split it into a separate line).

- **Watchlist digest now arrives at a consistent local time** — the daily email used to run on a fixed UTC schedule, so it landed an hour later (or earlier) in Italy depending on daylight saving time. It's now pinned to 8am Italian time year-round, ahead of market open, automatically adjusting across the seasonal clock change.

- **Watchlist digest now knows what you already own** — if a watched ticker's price drops below your buy target and you already hold a position in it, the email no longer suggests it as a fresh "buying opportunity." Instead it shows your existing holding (shares, average cost, current P&L%) and nudges you to consider adding to the position rather than treating it as a new buy.

- **Watchlist digest emails no longer arrive on weekends** — since markets are closed Saturday and Sunday, the daily digest now runs Monday through Friday only, so you won't get an email repeating Friday's numbers.

- **Buy/Watch/Over verdict now factors in every analyst opinion** — on Saved Analyses, the Watchlist, and the email digest, the verdict badge, the ruler's buy/watch zones, and the buy-target percentage now use the **consensus** (the base analysis plus every analyst lens that ran) once you've run at least one, instead of only the base analysis — a more robust signal when you've gathered a second opinion. The percentage now also states its source, "... (analysis)" or "... (consensus)", so it's never ambiguous which buy target it's measured against.

- **The Analyst Panel now sees your pasted data too** — when you run the Skeptic, Optimist, or Quality lens on a Grounded analysis, each one reasons over the same historical data and anchors you provided instead of re-deriving everything from the finished report — so a lens's critique is checked against the same numbers you supplied, not guessed at from scratch.

- **Grounded Deep Value analyses now reconcile your historical multiples table to the same accounting basis as your pasted financials** before applying any multiple to them. Previously, a historical multiple computed on a different EBITDA definition than your income statement could silently inflate or deflate the fair value; the report and the deterministic post-check now detect this, show the basis difference, and use the corrected, apples-to-apples multiple.

- **The deterministic post-check on Grounded analyses is significantly more thorough.** Beyond the existing bridge-arithmetic check, it now verifies: whether the bear case genuinely falls below today's price; whether the bull and bear scenarios are underwritten to the same year; whether the dividend is actually covered by free cash flow; whether a business earning below its cost of capital is being valued at a rich multiple without justification; and whether the mandatory second valuation method reconciles with the primary one, including a check on that second method's own accounting basis. It also now shows a probability-weighted expected value across your bull/base/bear scenarios.

- **Analyst reviews no longer open with praise.** Every review now leads with the errors found, the single most fragile assumption, and the one number that would flip the conclusion, rather than a compliment on the report's execution — a sharper, more useful second opinion.

## 🔒 Security

- Registration can be disabled via the `DISABLE_REGISTRATION=true` environment variable — useful to lock down the app after initial setup.
- AI fair value targets are always computed server-side and cannot be manipulated by the client.

## 📚 Documentation

- Added a database inspection guide to the README — how to browse users and saved analyses via the Turso web UI, Turso CLI, local SQLite, and Prisma Studio.
