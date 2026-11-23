"use client";

// The sources under a chart drawn from a financial dataset: one chip per site (or one for the
// paste) of the statement the chart reads, or of every statement, with how many fiscal years
// it filled. Grouped by host, not by page (owner, 2026-11-23): two pages of one site showed
// as two identical chips («snam.it ×2», «snam.it ×1») told apart only by their tooltip; the
// grouped chip's tooltip lists the pages' titles instead. A verified and an unverified source
// of one site stay apart, so «unverified» is never hidden. A row saved before rows carried
// their sources has none and is skipped; with no source anywhere nothing is drawn.
import { useLanguage } from "@/context/language-context";
import { SourceChip } from "@/components/report/source-chip";
import { sourceHost, type DataSource, type StatementKind } from "@/types/dataset";
import type { GroundedFinancials } from "@/types/grounding";

const STATEMENTS: StatementKind[] = ["income", "balance", "cashFlow"];

/** The group a source counts in: every pasted block is «the paste», a web page its site. */
function groupKey(source: DataSource): string {
  if (source.kind === "paste") return "paste";
  return `web:${sourceHost(source.url) ?? source.title ?? ""}:${source.verified ? "verified" : "unverified"}`;
}

/**
 * The sources grouped by site, in first-seen order, each with the number of fiscal years its
 * pages filled. The group's source is its first page, with the distinct page titles joined as
 * its title (what the chip's tooltip shows) and no date (the pages may differ).
 */
export function groupedSources(
  extract: GroundedFinancials | null,
  statement?: StatementKind
): { key: string; source: DataSource; years: number }[] {
  const groups = new Map<string, { first: DataSource; titles: Set<string>; years: Set<number> }>();
  for (const row of extract?.financials ?? []) {
    for (const kind of statement ? [statement] : STATEMENTS) {
      const source = row.sources?.[kind] ?? null;
      if (!source) continue;
      const key = groupKey(source);
      const group = groups.get(key) ?? { first: source, titles: new Set<string>(), years: new Set<number>() };
      if (source.title) group.titles.add(source.title);
      group.years.add(row.fiscalYear);
      groups.set(key, group);
    }
  }
  return [...groups.entries()].map(([key, { first, titles, years }]) => ({
    key,
    source: first.kind === "web" && titles.size > 1 ? { ...first, title: [...titles].join(" · "), asOf: null } : first,
    years: years.size,
  }));
}

export function SourceLegend({ extract, statement }: { extract: GroundedFinancials | null; statement?: StatementKind }) {
  const { t } = useLanguage();
  const groups = groupedSources(extract, statement);
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted print:text-slate-600" data-testid="source-legend">
      <span>{t("chartSourcesLegend")}:</span>
      {groups.map(({ key, source, years }) => (
        <span key={key} className="inline-flex items-center gap-1">
          <SourceChip source={source} />
          <span>×{years}</span>
        </span>
      ))}
    </div>
  );
}
