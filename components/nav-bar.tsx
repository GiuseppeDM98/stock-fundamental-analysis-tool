"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLanguage } from "@/context/language-context";
import type { Language } from "@/lib/i18n/translations";

/**
 * Top navigation bar shown on all pages.
 *
 * Auth state drives the content:
 * - Logged in: 6 pipeline links + user email + Sign Out
 * - Logged out: Login + Register (only two items, fit on any width)
 *
 * Responsive: the inline link row only renders at `lg`+ (≥1024px). Below `lg`
 * the logged-in links collapse into a hamburger that opens a portaled slide-in
 * drawer — the six links could not fit beside the brand on a phone. The brand
 * and the language toggle stay inline at every width.
 */
const LANGUAGE_FLAGS: Record<Language, string> = { en: "🇬🇧", it: "🇮🇹" };
const LANGUAGE_LABELS: Record<Language, string> = { en: "EN", it: "IT" };
const NEXT_LANGUAGE: Record<Language, Language> = { en: "it", it: "en" };

/** The pipeline links, in nav order. Shared by the desktop row and the drawer. */
const NAV_LINKS = [
  { href: "/advisor", key: "navAdvisor" },
  { href: "/compare", key: "navCompare" },
  { href: "/analyze", key: "navDeepValue" },
  { href: "/watchlist", key: "navWatchlist" },
  { href: "/portfolio", key: "navPortfolio" },
  { href: "/analyses", key: "navSavedAnalyses" },
] as const;

export default function NavBar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { language, setLanguage, t } = useLanguage();

  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const reduceMotion = useReducedMotion();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // createPortal needs document.body, which is absent during SSR.
  useEffect(() => setMounted(true), []);

  // Close the drawer on route change — clicking a link navigates but would
  // otherwise leave the drawer open over the new page.
  useEffect(() => setMenuOpen(false), [pathname]);

  // While the drawer is open: lock body scroll, close on Escape, and trap Tab
  // focus inside the panel (keyboard users shouldn't tab to the page behind it).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen]);

  function navLinkClass(href: string) {
    const isActive = pathname === href;
    return isActive
      ? "font-medium text-slate-100"
      : "text-muted transition hover:text-slate-100";
  }

  function drawerLinkClass(href: string) {
    const isActive = pathname === href;
    // Base py-2.5 height even on fine pointers (e.g. a narrowed desktop window);
    // .tap only lifts the floor to 44px on touch.
    return `tap flex items-center rounded-lg px-3 py-2.5 text-base transition ${
      isActive
        ? "bg-slate-800/60 font-medium text-slate-100"
        : "text-muted hover:bg-slate-800/40 hover:text-slate-100"
    }`;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-[#070d19]/80 backdrop-blur-md print:hidden">
      {/* Top safe-area inset keeps the brand/hamburger clear of the notch on
          notched phones (viewport-fit=cover); 0.75rem is the rest-state pad. */}
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/"
          className="text-sm font-semibold text-accent hover:text-sky-300"
        >
          Stock Analysis
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          {/* Language toggle — always inline, at every width */}
          <button
            onClick={() => setLanguage(NEXT_LANGUAGE[language])}
            aria-label={t("selectLanguage")}
            className="tap flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-slate-500 hover:text-slate-100"
          >
            {LANGUAGE_FLAGS[language]} {LANGUAGE_LABELS[language]}
          </button>

          {status === "loading" ? null : session ? (
            <>
              {/* Desktop inline links (≥ lg) */}
              <div className="hidden items-center gap-4 lg:flex">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={navLinkClass(link.href)}
                  >
                    {t(link.key)}
                  </Link>
                ))}
                <span className="text-muted">{session.user?.email}</span>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="rounded-lg border border-slate-700 px-3 py-1 text-muted transition hover:border-slate-500 hover:text-slate-100"
                >
                  {t("navSignOut")}
                </button>
              </div>

              {/* Mobile/tablet hamburger (< lg) */}
              <button
                ref={openButtonRef}
                onClick={() => setMenuOpen(true)}
                aria-label={t("navOpenMenu")}
                aria-expanded={menuOpen}
                className="tap flex items-center justify-center rounded-md border border-slate-700 px-2 py-1 text-muted transition hover:border-slate-500 hover:text-slate-100 lg:hidden"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="tap flex items-center text-muted transition hover:text-slate-100"
              >
                {t("navSignIn")}
              </Link>
              <Link
                href="/register"
                className="tap flex items-center rounded-lg bg-sky-500 px-3 py-1 font-semibold text-white transition hover:bg-sky-400"
              >
                {t("navRegister")}
              </Link>
            </>
          )}
        </nav>
      </div>

      {/* Slide-in drawer for the logged-in links below lg. Portaled to body so
          it escapes the sticky header's stacking context and overflow. */}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {menuOpen && session && (
              <motion.div
                className="fixed inset-0 z-[60] lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                  onClick={() => setMenuOpen(false)}
                />
                <motion.div
                  ref={panelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("navOpenMenu")}
                  className="absolute inset-y-0 right-0 flex w-72 max-w-[80vw] flex-col gap-1 border-l border-slate-800 bg-[#070d19] p-4 pt-[max(1rem,env(safe-area-inset-top))]"
                  initial={reduceMotion ? { opacity: 0 } : { x: "100%" }}
                  animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { x: "100%" }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="truncate text-xs text-muted">
                      {session.user?.email}
                    </span>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        openButtonRef.current?.focus();
                      }}
                      aria-label={t("navCloseMenu")}
                      className="tap flex items-center justify-center rounded-md border border-slate-700 px-2 py-1 text-muted transition hover:border-slate-500 hover:text-slate-100"
                    >
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>

                  {NAV_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={drawerLinkClass(link.href)}
                    >
                      {t(link.key)}
                    </Link>
                  ))}

                  <button
                    onClick={() => signOut({ callbackUrl: "/" })}
                    className="tap mt-2 flex items-center rounded-lg border border-slate-700 px-3 py-2.5 text-base text-muted transition hover:border-slate-500 hover:text-slate-100"
                  >
                    {t("navSignOut")}
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </header>
  );
}
