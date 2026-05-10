"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import Link from "next/link";

/**
 * Top navigation bar shown on all pages.
 * Shows different content based on auth state:
 * - Logged in: user email + Saved Analyses link + Sign Out button
 * - Logged out: Login + Register links
 */
export default function NavBar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

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
          {status === "loading" ? null : session ? (
            <>
              <Link href="/analyses" className={navLinkClass("/analyses")}>
                Saved Analyses
              </Link>
              <Link href="/portfolio" className={navLinkClass("/portfolio")}>
                Portfolio
              </Link>
              <span className="text-muted">{session.user?.email}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-lg border border-slate-700 px-3 py-1 text-muted transition hover:border-slate-500 hover:text-slate-100"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-muted transition hover:text-slate-100"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-sky-500 px-3 py-1 font-semibold text-white transition hover:bg-sky-400"
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
