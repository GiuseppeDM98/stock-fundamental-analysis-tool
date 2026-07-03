import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        card: "var(--card)",
        accent: "var(--accent)",
        muted: "var(--muted)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)"
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui"],
        body: ["Manrope", "ui-sans-serif", "system-ui"]
      },
      typography: ({ theme }: { theme: (path: string) => unknown }) => ({
        // "report" variant — tuned for an equity-research-style Markdown report.
        // Numbered H2 sections (the AI always emits "## N. Title") get a top rule
        // + generous top margin so CSS alone creates the section-divider look,
        // with no need to parse/inject anything into the AI's Markdown output.
        report: {
          css: {
            "--tw-prose-body": "rgb(203 213 225)", // slate-300
            "--tw-prose-headings": "rgb(241 245 249)", // slate-100
            "--tw-prose-bold": "rgb(196 181 253)", // violet-300 — makes the moat rating pop
            "--tw-prose-links": "rgb(167 139 250)", // violet-400
            "--tw-prose-hr": "rgb(51 65 85 / 0.5)", // slate-700/50
            "--tw-prose-th-borders": "rgb(51 65 85 / 0.6)", // slate-700/60
            "--tw-prose-td-borders": "rgb(51 65 85 / 0.4)", // slate-700/40
            maxWidth: "none",
            fontFamily: (theme("fontFamily.body") as string[]).join(", "),
            h1: { fontFamily: (theme("fontFamily.display") as string[]).join(", ") },
            h2: {
              fontFamily: (theme("fontFamily.display") as string[]).join(", "),
              fontWeight: "600",
              fontSize: "1.05em",
              borderTop: "1px solid var(--tw-prose-hr)",
              paddingTop: "1.5em",
              marginTop: "2.25em",
            },
            "h2:first-of-type": { borderTop: "none", paddingTop: "0", marginTop: "0" },
            h3: { fontFamily: (theme("fontFamily.display") as string[]).join(", "), fontWeight: "600" },
            strong: { fontWeight: "600" },
            table: { fontSize: "0.9em" },
          },
        },
      }),
    }
  },
  plugins: [typography]
};

export default config;
