"use client";

// The rows of a financial dataset, one table per statement (income, balance sheet, cash
// flow, historical multiples, estimates), the fiscal years as columns and a "Source" row
// first, so every number can be traced to the paste or the page it came from. Shared by
// the extraction preview, the reuse view on /analyze and the saved-analysis page.
//
// `.rtable`: below sm each row becomes a card (the source row first). The thead is hidden
// there and a data-label cannot hold a component, so the chips live in the tbody, never
// in the thead.
import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import type { GroundedFinancials } from "@/types/grounding";
import { STATEMENT_FIELD_KIND, type DataSource, type FinancialField, type StatementKind } from "@/types/dataset";
import { SourceChip } from "./source-chip";

// `values` is the dataset row itself, read by field key.
type Row = { fiscalYear: number; values: Readonly<Record<string, unknown>>; source: DataSource | null; mixed: boolean };
type Field = { key: string; labelKey: keyof Translations; decimals: number };
type Table = { id: string; titleKey: keyof Translations; fields: Field[]; rows: Row[] };

// How many fiscal years a compact table keeps: the most recent ones.
const COMPACT_YEARS = 3;

const FIELD_LABEL_KEY: Record<string, keyof Translations> = {
  revenue: "datasetFieldRevenue",
  ebitda: "datasetFieldEbitda",
  ebit: "datasetFieldEbit",
  netIncome: "datasetFieldNetIncome",
  eps: "datasetFieldEps",
  sharesDiluted: "datasetFieldSharesDiluted",
  dividendsPerShare: "datasetFieldDividendsPerShare",
  totalEquity: "datasetFieldTotalEquity",
  minorityInterest: "datasetFieldMinorityInterest",
  totalDebt: "datasetFieldTotalDebt",
  cashAndEquivalents: "datasetFieldCashAndEquivalents",
  netDebt: "datasetFieldNetDebt",
  cfo: "datasetFieldCfo",
  capex: "datasetFieldCapex",
  depreciationAmortization: "datasetFieldDepreciationAmortization",
  freeCashFlow: "datasetFieldFreeCashFlow",
  evEbitda: "datasetFieldEvEbitda",
  evSales: "datasetFieldEvSales",
  pe: "datasetFieldPe",
  pb: "datasetFieldPb",
  fcfYield: "datasetFieldFcfYield",
  dividendYield: "datasetFieldDividendYield",
  marketCap: "datasetFieldMarketCap",
  enterpriseValue: "datasetFieldEnterpriseValue",
};

// Per-share figures and ratios get two decimals; amounts (and share counts) none.
const TWO_DECIMALS = new Set(["eps", "dividendsPerShare", "evEbitda", "evSales", "pe", "pb", "fcfYield", "dividendYield"]);

const field = (key: string): Field => ({ key, labelKey: FIELD_LABEL_KEY[key], decimals: TWO_DECIMALS.has(key) ? 2 : 0 });

const STATEMENTS: { kind: StatementKind; titleKey: keyof Translations }[] = [
  { kind: "income", titleKey: "datasetTableIncome" },
  { kind: "balance", titleKey: "datasetTableBalance" },
  { kind: "cashFlow", titleKey: "datasetTableCashFlow" },
];

const MULTIPLE_FIELDS = ["evEbitda", "evSales", "pe", "pb", "fcfYield", "dividendYield", "marketCap", "enterpriseValue"].map(field);
const ESTIMATE_FIELDS = ["revenue", "ebitda", "ebit", "netIncome", "eps"].map(field);

function buildTables(extract: GroundedFinancials): Table[] {
  const statementTables = STATEMENTS.map(({ kind, titleKey }) => ({
    id: kind,
    titleKey,
    fields: (Object.keys(STATEMENT_FIELD_KIND) as FinancialField[]).filter((k) => STATEMENT_FIELD_KIND[k] === kind).map(field),
    rows: extract.financials.map((f) => ({ fiscalYear: f.fiscalYear, values: f, source: f.sources[kind], mixed: f.sources.mixed[kind] })),
  }));
  return [
    ...statementTables,
    {
      id: "multiples",
      titleKey: "datasetTableMultiples",
      fields: MULTIPLE_FIELDS,
      rows: extract.multiples.map((m) => ({ fiscalYear: m.fiscalYear, values: m, source: m.source, mixed: false })),
    },
    {
      id: "estimates",
      titleKey: "datasetTableEstimates",
      fields: ESTIMATE_FIELDS,
      rows: extract.estimates.map((e) => ({ fiscalYear: e.fiscalYear, values: e, source: e.source, mixed: false })),
    },
  ];
}

const numberAt = (row: Row, key: string): number | null => {
  const value = row.values[key];
  return typeof value === "number" ? value : null;
};
/** A table is shown only when one of its fields has a value: a paste of the income
 *  statement alone shows no empty balance sheet. */
const hasValues = (table: Table) => table.rows.some((r) => table.fields.some((f) => numberAt(r, f.key) != null));

export function DatasetTables({ extract, compact = false }: { extract: GroundedFinancials; compact?: boolean }) {
  const { t, locale } = useLanguage();
  const tables = buildTables(extract).filter(hasValues);
  if (tables.length === 0) return null;

  const unit = [extract.meta.reportingCurrency, extract.meta.units].filter(Boolean).join(" · ");
  const format = (value: number | null, decimals: number) =>
    value == null ? "—" : value.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {tables.map((table) => {
        const rows = compact ? table.rows.slice(-COMPACT_YEARS) : table.rows;
        const cell = compact ? "py-1" : "py-1.5";
        return (
          <section
            key={table.id}
            data-testid={`dataset-table-${table.id}`}
            className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3 print:break-inside-avoid print:border-slate-300 print:bg-transparent sm:p-4"
          >
            <h4 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs font-semibold text-slate-200 print:text-slate-900">
              {t(table.titleKey)}
              {unit && <span className="font-normal text-muted print:text-slate-600">{unit}</span>}
            </h4>
            <div className="overflow-x-auto">
              <table className={`rtable w-full ${compact ? "text-[11px]" : "text-xs"}`}>
                <thead>
                  <tr className="border-b border-slate-700/60 print:border-slate-300">
                    <th className="pb-1.5 pr-3 text-left font-medium text-slate-400 print:text-slate-600" />
                    {rows.map((r) => (
                      <th key={r.fiscalYear} className="pb-1.5 pl-3 text-right font-medium text-slate-400 print:text-slate-600">
                        {r.fiscalYear}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-700/30 print:border-slate-200">
                    <td className={`rcell-block ${cell} pr-3 text-muted print:text-slate-600`}>{t("datasetSourceRow")}</td>
                    {rows.map((r) => (
                      <td key={r.fiscalYear} data-label={String(r.fiscalYear)} className={`${cell} pl-3 text-right`}>
                        <SourceChip source={r.source} mixed={r.mixed} />
                      </td>
                    ))}
                  </tr>
                  {table.fields.map((f) => (
                    <tr key={f.key} className="border-b border-slate-700/30 last:border-0 print:border-slate-200">
                      <td className={`rcell-block ${cell} pr-3 text-slate-300 print:text-slate-800`}>{t(f.labelKey)}</td>
                      {rows.map((r) => (
                        <td key={r.fiscalYear} data-label={String(r.fiscalYear)} className={`${cell} pl-3 text-right tabular-nums text-slate-200 print:text-slate-900`}>
                          {format(numberAt(r, f.key), f.decimals)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
