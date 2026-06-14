import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import WatchlistClient from "@/components/watchlist-client";

export const metadata = { title: "Watchlist – Stock Analysis" };

export default async function WatchlistPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader titleKey="watchlistPageTitle" descKey="watchlistPageDesc" />
      <WatchlistClient />
    </main>
  );
}
