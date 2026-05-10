import "@testing-library/jest-dom";
import { vi } from "vitest";
import { translations } from "./lib/i18n/translations";

vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({
    language: "en" as const,
    setLanguage: vi.fn(),
    t: (key: string) => translations.en[key as keyof typeof translations.en] ?? key,
    locale: "en-US",
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));
