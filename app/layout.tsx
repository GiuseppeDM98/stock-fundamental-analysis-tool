import type { Metadata } from "next";
import "./globals.css";
import SessionProvider from "@/components/session-provider";
import NavBar from "@/components/nav-bar";

export const metadata: Metadata = {
  title: "Stock Fundamental Analysis Tool",
  description: "Fair value analysis with multi-scenario DCF and margin of safety"
};

/**
 * Root layout component that wraps all pages in the application.
 *
 * Provides:
 * - SEO metadata (title, description)
 * - Global styles from globals.css
 * - Dark theme background (bg-bg) and text color
 * - Font antialiasing for better readability
 * - SessionProvider for Auth.js client-side session access
 * - NavBar with auth-aware navigation
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body bg-bg text-slate-100 antialiased">
        <SessionProvider>
          <NavBar />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
