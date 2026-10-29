/*
 * Loaded by app/globals.css through `@config`. Tailwind 4 takes everything else from the
 * CSS (`@theme` tokens, `@source` paths); this file is kept only because the typography
 * plugin's custom variants can still only be declared from a JS config.
 */
import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

/*
 * The typography plugin's default (gray) colours as Tailwind 3 resolved them. The plugin reads
 * its colours from `tailwindcss/colors`, which in Tailwind 4 is the OKLCH palette, so without
 * these every prose colour the report does not set itself (bullets, counters, code, quotes, …)
 * would shift slightly.
 */
const PROSE_GRAY_V3: Record<string, string> = {
  "--tw-prose-body": "#374151",
  "--tw-prose-headings": "#111827",
  "--tw-prose-lead": "#4b5563",
  "--tw-prose-links": "#111827",
  "--tw-prose-bold": "#111827",
  "--tw-prose-counters": "#6b7280",
  "--tw-prose-bullets": "#d1d5db",
  "--tw-prose-hr": "#e5e7eb",
  "--tw-prose-quotes": "#111827",
  "--tw-prose-quote-borders": "#e5e7eb",
  "--tw-prose-captions": "#6b7280",
  "--tw-prose-kbd": "#111827",
  "--tw-prose-kbd-shadows": "rgb(17 24 39 / 10%)",
  "--tw-prose-code": "#111827",
  "--tw-prose-pre-code": "#e5e7eb",
  "--tw-prose-pre-bg": "#1f2937",
  "--tw-prose-th-borders": "#d1d5db",
  "--tw-prose-td-borders": "#e5e7eb",
  "--tw-prose-invert-body": "#d1d5db",
  "--tw-prose-invert-headings": "#fff",
  "--tw-prose-invert-lead": "#9ca3af",
  "--tw-prose-invert-links": "#fff",
  "--tw-prose-invert-bold": "#fff",
  "--tw-prose-invert-counters": "#9ca3af",
  "--tw-prose-invert-bullets": "#4b5563",
  "--tw-prose-invert-hr": "#374151",
  "--tw-prose-invert-quotes": "#f3f4f6",
  "--tw-prose-invert-quote-borders": "#374151",
  "--tw-prose-invert-captions": "#9ca3af",
  "--tw-prose-invert-kbd": "#fff",
  "--tw-prose-invert-kbd-shadows": "rgb(255 255 255 / 10%)",
  "--tw-prose-invert-code": "#fff",
  "--tw-prose-invert-pre-code": "#d1d5db",
  "--tw-prose-invert-pre-bg": "rgb(0 0 0 / 50%)",
  "--tw-prose-invert-th-borders": "#4b5563",
  "--tw-prose-invert-td-borders": "#374151",
};

/*
 * Sets each report colour as both `--tw-prose-<name>` and `--tw-prose-invert-<name>`.
 * The report is always rendered `prose prose-invert prose-report`, and `prose-invert` sets
 * `--tw-prose-<name>: var(--tw-prose-invert-<name>)`. Tailwind 3 emitted `.prose-report`
 * after `.prose-invert`, so the report colours won; Tailwind 4 orders them the other way
 * round. Overriding the invert source as well makes the result independent of that order.
 */
function reportColors(colors: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(colors)) {
    vars[`--tw-prose-${name}`] = value;
    vars[`--tw-prose-invert-${name}`] = value;
  }
  return vars;
}

const config: Config = {
  // The content paths are the `@source` directives in app/globals.css.
  content: [],
  theme: {
    extend: {
      typography: {
        DEFAULT: { css: PROSE_GRAY_V3 },
        // "report" variant — tuned for an equity-research-style Markdown report.
        // Numbered H2 sections (the AI always emits "## N. Title") get a top rule
        // + generous top margin so CSS alone creates the section-divider look,
        // with no need to parse/inject anything into the AI's Markdown output.
        report: {
          css: {
            ...reportColors({
              body: "rgb(203 213 225)", // slate-300
              headings: "rgb(241 245 249)", // slate-100
              bold: "rgb(196 181 253)", // violet-300 — makes the moat rating pop
              links: "rgb(167 139 250)", // violet-400
              hr: "rgb(51 65 85 / 0.5)", // slate-700/50
              "th-borders": "rgb(51 65 85 / 0.6)", // slate-700/60
              "td-borders": "rgb(51 65 85 / 0.4)", // slate-700/40
            }),
            maxWidth: "none",
            // The font tokens are declared in app/globals.css (`@theme`).
            fontFamily: "var(--font-body)",
            h1: { fontFamily: "var(--font-display)" },
            h2: {
              fontFamily: "var(--font-display)",
              fontWeight: "600",
              fontSize: "1.05em",
              borderTop: "1px solid var(--tw-prose-hr)",
              paddingTop: "1.5em",
              marginTop: "2.25em",
            },
            "h2:first-of-type": { borderTop: "none", paddingTop: "0", marginTop: "0" },
            h3: { fontFamily: "var(--font-display)", fontWeight: "600" },
            strong: { fontWeight: "600" },
            table: { fontSize: "0.9em" },
          },
        },
      },
    },
  },
  plugins: [typography],
};

export default config;
