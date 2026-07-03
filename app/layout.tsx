import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./print.css";
import SessionProvider from "@/components/session-provider";
import NavBar from "@/components/nav-bar";
import PwaRegister from "@/components/pwa-register";
import { LanguageProvider } from "@/context/language-context";

export const metadata: Metadata = {
  title: "Stock Fundamental Analysis Tool",
  description: "Fair value analysis with multi-scenario DCF and margin of safety",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StockFA",
  },
  icons: {
    icon: [{ url: "/icon", type: "image/png", sizes: "32x32" }],
    apple: "/icons/icon-192.svg",
  },
};

// themeColor belongs in the viewport export in Next.js 15+.
// viewportFit: "cover" lets the app draw into the notch/home-indicator area on
// modern phones (this is an installable PWA); globals.css then pads sticky
// surfaces back out with env(safe-area-inset-*).
export const viewport: Viewport = {
  themeColor: "#0f172a",
  viewportFit: "cover",
};

/**
 * Root layout component that wraps all pages in the application.
 *
 * Provides:
 * - SEO + PWA metadata (title, description, manifest, theme color, apple-touch-icon)
 * - Global styles from globals.css
 * - Dark theme background (bg-bg) and text color
 * - Font antialiasing for better readability
 * - SessionProvider for Auth.js client-side session access
 * - NavBar with auth-aware navigation
 * - PwaRegister for service worker registration (enables install prompt on mobile)
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body bg-bg text-slate-100 antialiased">
        <LanguageProvider>
          <SessionProvider>
            <NavBar />
            {children}
          </SessionProvider>
        </LanguageProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
