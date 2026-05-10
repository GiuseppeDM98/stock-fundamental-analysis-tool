"use client";

/**
 * App-wide language context.
 *
 * Provides the current Language, a setter, a t() translation helper,
 * and the BCP 47 locale string for Intl formatting.
 *
 * Hydration guard: localStorage is only available after mount, so the
 * initial render uses the default "en" to avoid SSR/client mismatches.
 * After mount, the stored preference is applied (same pattern used by
 * other LocalStorage-backed state in this codebase).
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  translations,
  LANGUAGE_LOCALE,
  type Language,
  type Translations,
} from "@/lib/i18n/translations";

const STORAGE_KEY = "sfa:language";
const DEFAULT_LANGUAGE: Language = "en";

type LanguageContextValue = {
  language: Language;
  setLanguage: (lang: Language) => void;
  /** Returns the translated string for the given key. */
  t: (key: keyof Translations) => string;
  /** BCP 47 locale string for Intl formatting (e.g. "en-US", "it-IT"). */
  locale: string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  // Read persisted preference after hydration
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (stored === "en" || stored === "it") {
      setLanguageState(stored);
      document.documentElement.lang = stored;
    }
  }, []);

  function setLanguage(lang: Language) {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }

  function t(key: keyof Translations): string {
    return translations[language][key];
  }

  const locale = LANGUAGE_LOCALE[language];

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, locale }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
}
