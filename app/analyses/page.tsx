import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AnalysesList from "@/components/analyses-list";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Saved Analyses – Stock Analysis" };

export default async function AnalysesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader titleKey="analysesPageTitle" descKey="analysesPageDesc" />
      <AnalysesList />
    </main>
  );
}
