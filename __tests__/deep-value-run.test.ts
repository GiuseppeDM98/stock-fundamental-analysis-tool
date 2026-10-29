import { describe, it, expect } from "vitest";
import { buildSaveAnalysisRequest, parseResolvedAiSettings, type DeepValueRunInputs } from "@/lib/report/deep-value-run";
import type { DeepValueResult } from "@/components/report/types";
import type { GroundingPayload } from "@/types/grounding";
import { makeExtract } from "./grounding-test-helpers";

const GROUNDING: GroundingPayload = { blocks: [{ id: "1", kind: "balance_sheet", text: "pasted" }], extract: makeExtract({}) };

const RUN: DeepValueRunInputs = {
  ticker: "ENI.MI",
  companyName: "Eni",
  mosPercent: 20,
  currentPrice: 14.18,
  currency: "EUR",
  grounding: GROUNDING,
  language: "English",
  aiSettingsResolved: { model: "claude-opus-4-8", effort: "xhigh", thinking: true },
};

const RESULT = {
  method: "EV/EBITDA",
  sector: "Energy",
  currency: "EUR",
  bull: { fairValue: 20 },
  base: { fairValue: 16 },
  bear: { fairValue: 11 },
} as DeepValueResult;

describe("buildSaveAnalysisRequest", () => {
  it("sends the price the run started with as priceAtAnalysis", () => {
    expect(buildSaveAnalysisRequest(RUN, "# r", RESULT).priceAtAnalysis).toBe(14.18);
  });

  it("omits priceAtAnalysis when no positive price was known", () => {
    expect(buildSaveAnalysisRequest({ ...RUN, currentPrice: null }, "# r", RESULT).priceAtAnalysis).toBeUndefined();
    expect(buildSaveAnalysisRequest({ ...RUN, currentPrice: 0 }, "# r", RESULT).priceAtAnalysis).toBeUndefined();
  });

  it("serializes the grounding payload the run used, and none for a Quick run", () => {
    expect(JSON.parse(buildSaveAnalysisRequest(RUN, "# r", RESULT).groundingJson!)).toEqual(GROUNDING);
    expect(buildSaveAnalysisRequest({ ...RUN, grounding: null }, "# r", RESULT).groundingJson).toBeUndefined();
  });

  it("maps the snapshot's MoS and the parsed fair values", () => {
    const req = buildSaveAnalysisRequest(RUN, "# r", RESULT);
    expect(req).toMatchObject({
      ticker: "ENI.MI",
      companyName: "Eni",
      mosPercent: 20,
      reportMd: "# r",
      fairValueBull: 20,
      fairValueBase: 16,
      fairValueBear: 11,
      valuationMethod: "EV/EBITDA",
    });
  });

  it("omits fair values when the JSON block did not parse", () => {
    const req = buildSaveAnalysisRequest(RUN, "# r", null);
    expect(req.fairValueBase).toBeUndefined();
    expect(req.valuationMethod).toBeUndefined();
  });

  it("saves Markdown only, without throwing, when the parsed block lacks a scenario", () => {
    const { bear: _dropped, ...withoutBear } = RESULT;
    const req = buildSaveAnalysisRequest(RUN, "# r", withoutBear);
    expect(req.reportMd).toBe("# r");
    expect(req.fairValueBull).toBeUndefined();
    expect(req.fairValueBase).toBeUndefined();
    expect(req.fairValueBear).toBeUndefined();
    expect(req.valuationMethod).toBeUndefined();
  });

  it("sends the sanitized result and the run metadata the route resolved", () => {
    const req = buildSaveAnalysisRequest(RUN, "# r", RESULT);
    expect(JSON.parse(req.resultJson!)).toEqual(RESULT);
    expect(req).toMatchObject({ currency: "EUR", sector: "Energy", reportLanguage: "English", aiModel: "claude-opus-4-8", aiEffort: "xhigh", aiThinking: true });
    const noHeader = buildSaveAnalysisRequest({ ...RUN, aiSettingsResolved: null }, "# r", RESULT);
    expect(noHeader.aiModel).toBeUndefined();
    expect(noHeader.aiEffort).toBeUndefined();
    expect(noHeader.aiThinking).toBeUndefined();
    expect(buildSaveAnalysisRequest(RUN, "# r", null).resultJson).toBeUndefined();
  });

  it("trims the sector to 80 and the method to 40, and drops a currency that is not a bare ISO code", () => {
    const req = buildSaveAnalysisRequest(RUN, "# r", { ...RESULT, sector: "S".repeat(120), method: "M".repeat(50), currency: "EUR (euro)" });
    expect(req.sector).toHaveLength(80);
    expect(req.valuationMethod).toHaveLength(40);
    expect(req.currency).toBeUndefined();
  });
});

describe("parseResolvedAiSettings", () => {
  it("reads the header the route writes", () => {
    expect(parseResolvedAiSettings('{"model":"claude-opus-4-8","effort":"xhigh","thinking":true}')).toEqual({ model: "claude-opus-4-8", effort: "xhigh", thinking: true });
  });

  it("returns null for a missing, malformed or unknown header", () => {
    expect(parseResolvedAiSettings(null)).toBeNull();
    expect(parseResolvedAiSettings("not json")).toBeNull();
    expect(parseResolvedAiSettings('{"model":"gpt-9","effort":"xhigh","thinking":true}')).toBeNull();
    expect(parseResolvedAiSettings('{"model":"claude-opus-4-8","effort":"ultra","thinking":true}')).toBeNull();
    expect(parseResolvedAiSettings('{"model":"claude-opus-4-8","effort":"high"}')).toBeNull();
  });
});
