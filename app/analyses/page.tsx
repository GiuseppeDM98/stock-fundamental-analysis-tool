import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AnalysesList from "@/components/analyses-list";

export const metadata = { title: "Saved Analyses – Stock Analysis" };

/**
 * Saved Analyses page.
 * Server-side auth check: redirects to /login if not authenticated.
 * Renders the AnalysesList client component which fetches data on mount.
 */
export default async function AnalysesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">Saved Analyses</h1>
        <p className="mt-1 text-sm text-slate-400">
          Your AI-generated investment research reports
        </p>
      </div>

      <AnalysesList />
    </main>
  );
}
