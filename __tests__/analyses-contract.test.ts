import { describe, it, expect } from "vitest";
import { ANALYSIS_LIST_SELECT, ANALYSIS_SUMMARY_SELECT } from "@/lib/analyses-select";

// The type check (`satisfies Record<keyof SavedAnalysis, true>`) keeps the select and the
// type in step; this pins the list itself, so a column dropped from both at once — or a
// blob slipping into the summary — shows up here too.
const EXPECTED_KEYS = [
  "id",
  "ticker",
  "companyName",
  "reportMd",
  "mosPercent",
  "priceAtAnalysis",
  "fairValueBull",
  "fairValueBase",
  "fairValueBear",
  "valuationMethod",
  "reviewMd",
  "reviewFairValueBull",
  "reviewFairValueBase",
  "reviewFairValueBear",
  "reviewValuationMethod",
  "optimistCritiqueMd",
  "optimistFairValueBull",
  "optimistFairValueBase",
  "optimistFairValueBear",
  "optimistValuationMethod",
  "qualityCritiqueMd",
  "qualityFairValueBull",
  "qualityFairValueBase",
  "qualityFairValueBear",
  "qualityValuationMethod",
  "reviewBlindJson",
  "optimistBlindJson",
  "qualityBlindJson",
  "resultJson",
  "currency",
  "sector",
  "reportLanguage",
  "aiModel",
  "aiEffort",
  "aiThinking",
  "reviewResultJson",
  "optimistResultJson",
  "qualityResultJson",
  "datasetId",
  "createdAt",
];

const BLOBS = [
  "reportMd",
  "reviewMd",
  "optimistCritiqueMd",
  "qualityCritiqueMd",
  "reviewBlindJson",
  "optimistBlindJson",
  "qualityBlindJson",
  "reviewResultJson",
  "optimistResultJson",
  "qualityResultJson",
];

describe("Analysis selects", () => {
  it("lists exactly the SavedAnalysis columns, groundingJson excluded", () => {
    expect(Object.keys(ANALYSIS_LIST_SELECT).sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(Object.values(ANALYSIS_LIST_SELECT).every((v) => v === true)).toBe(true);
    expect("groundingJson" in ANALYSIS_LIST_SELECT).toBe(false);
  });

  it("leaves out exactly the ten text blobs in the summary", () => {
    const excluded = Object.entries(ANALYSIS_SUMMARY_SELECT)
      .filter(([, v]) => v === false)
      .map(([k]) => k);
    expect(excluded.sort()).toEqual([...BLOBS].sort());
    expect(ANALYSIS_SUMMARY_SELECT.resultJson).toBe(true);
  });
});
