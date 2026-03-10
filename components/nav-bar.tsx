"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";

/**
 * Top navigation bar shown on all pages.
 * Shows different content based on auth state:
 * - Logged in: user email + Saved Analyses link + Sign Out button
 * - Logged out: Login + Register links
 */
export default function NavBar() {
  const { data: session, status } = useSession();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-[#070d19]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="text-sm font-semibold text-sky-400 hover:text-sky-300"
        >
          Stock Analysis
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          {status === "loading" ? null : session ? (
            <>
              <Link
                href="/analyses"
                className="text-slate-300 hover:text-slate-100"
              >
                Saved Analyses
              </Link>
              <span className="text-slate-500">{session.user?.email}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-lg border border-slate-700 px-3 py-1 text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-slate-300 hover:text-slate-100"
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
