import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import PortfolioList from "@/components/portfolio-list";
import PortfolioHistoryChart from "@/components/portfolio-history-chart";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Portfolio – Stock Analysis" };

export default async function PortfolioPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PageHeader titleKey="portfolioPageTitle" descKey="portfolioPageDesc" />
      <PortfolioHistoryChart />
      <PortfolioList />
    </main>
  );
}
