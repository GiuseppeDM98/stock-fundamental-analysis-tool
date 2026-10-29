import { describe, it, expect } from "vitest";
import { buildSaveAnalysisRequest, type DeepValueRunInputs } from "@/lib/report/deep-value-run";
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
});
