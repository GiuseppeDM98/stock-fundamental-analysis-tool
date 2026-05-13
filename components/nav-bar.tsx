"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useLanguage } from "@/context/language-context";
import type { Language } from "@/lib/i18n/translations";

/**
 * Top navigation bar shown on all pages.
 * Shows different content based on auth state:
 * - Logged in: user email + Saved Analyses link + Sign Out button
 * - Logged out: Login + Register links
 */
const LANGUAGE_FLAGS: Record<Language, string> = { en: "🇬🇧", it: "🇮🇹" };
const LANGUAGE_LABELS: Record<Language, string> = { en: "EN", it: "IT" };
const NEXT_LANGUAGE: Record<Language, Language> = { en: "it", it: "en" };

export default function NavBar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { language, setLanguage, t } = useLanguage();

  function navLinkClass(href: string) {
    const isActive = pathname === href;
    return isActive
      ? "font-medium text-slate-100"
      : "text-muted transition hover:text-slate-100";
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-[#070d19]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="text-sm font-semibold text-accent hover:text-sky-300"
        >
          Stock Analysis
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          {/* Language toggle — switches between EN and IT */}
          <button
            onClick={() => setLanguage(NEXT_LANGUAGE[language])}
            aria-label={t("selectLanguage")}
            className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-slate-500 hover:text-slate-100"
          >
            {LANGUAGE_FLAGS[language]} {LANGUAGE_LABELS[language]}
          </button>
          {status === "loading" ? null : session ? (
            <>
              <Link href="/analyses" className={navLinkClass("/analyses")}>
                {t("navSavedAnalyses")}
              </Link>
              <Link href="/portfolio" className={navLinkClass("/portfolio")}>
                {t("navPortfolio")}
              </Link>
              <Link href="/watchlist" className={navLinkClass("/watchlist")}>
                {t("navWatchlist")}
              </Link>
              <span className="text-muted">{session.user?.email}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-lg border border-slate-700 px-3 py-1 text-muted transition hover:border-slate-500 hover:text-slate-100"
              >
                {t("navSignOut")}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-muted transition hover:text-slate-100"
              >
                {t("navSignIn")}
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-sky-500 px-3 py-1 font-semibold text-white transition hover:bg-sky-400"
              >
                {t("navRegister")}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
