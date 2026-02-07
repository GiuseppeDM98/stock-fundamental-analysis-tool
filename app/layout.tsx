import type { Metadata } from "next";
import "./globals.css";

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
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body bg-bg text-slate-100 antialiased">{children}</body>
    </html>
  );
}
