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
