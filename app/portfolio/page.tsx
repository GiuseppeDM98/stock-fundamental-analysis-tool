import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import PortfolioList from "@/components/portfolio-list";

export const metadata = { title: "Portfolio – Stock Analysis" };

/**
 * Portfolio page — shows the user's saved stock positions with live P&L.
 * Server-side auth check: redirects to /login if not authenticated.
 */
export default async function PortfolioPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">Portfolio</h1>
        <p className="mt-1 text-sm text-slate-400">
          Track your stock positions and monitor P&amp;L against live prices
        </p>
      </div>

      <PortfolioList />
    </main>
  );
}
