import { describe, it, expect } from "vitest";
import { translations, type Translations } from "@/lib/i18n/translations";

// Keys added when the saved-analysis chrome, the report shell and the Deep Value panel
// stopped hardcoding English. The Translations type already forces both dictionaries to
// declare them; this documents that neither ships an empty string.
const NEW_KEYS: (keyof Translations)[] = [
  "backToSavedAnalyses",
  "rerunAnalysis",
  "reportDisclaimer",
  "recapScenario",
  "recapVsPrice",
  "recapBuyTarget",
  "recapFairValue",
  "reportLanguageAria",
  "watchlistAddError",
  "deepValueIncompleteJson",
];

describe("i18n keys", () => {
  it.each(NEW_KEYS)("%s exists, non-empty, in EN and IT", (key) => {
    expect(translations.en[key]?.trim()).toBeTruthy();
    expect(translations.it[key]?.trim()).toBeTruthy();
  });
});

// Shown on any dataset — web, paste or merged — so they name the dataset, never a paste
// (a web-only dataset read "not estimable from the paste" until 2026-11-09).
const DATASET_WIDE_KEYS: (keyof Translations)[] = ["groundingKbAssumed", "groundingWedgeCaveat"];

describe("i18n keys shown on every dataset", () => {
  it.each(DATASET_WIDE_KEYS)("%s names the dataset, not a paste, in EN and IT", (key) => {
    expect(translations.en[key]).toMatch(/dataset/);
    expect(translations.en[key]).not.toMatch(/paste/i);
    expect(translations.it[key]).toMatch(/dataset/);
    expect(translations.it[key]).not.toMatch(/incoll/i);
  });
});
