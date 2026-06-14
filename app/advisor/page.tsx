import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AdvisorClient from "@/components/advisor-client";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "AI Advisor – Stock Analysis" };

export default async function AdvisorPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto flex max-w-5xl flex-col px-4 py-8 sm:px-6" style={{ height: "calc(100dvh - 4rem)" }}>
      <PageHeader titleKey="advisorPageTitle" descKey="advisorPageDesc" />
      <AdvisorClient />
    </main>
  );
}
