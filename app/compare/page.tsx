import { CompareClient } from "@/components/compare-client";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ tickers?: string }>;
}) {
  const { tickers } = await searchParams;
  const initialTickers = tickers
    ? tickers
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return <CompareClient initialTickers={initialTickers} />;
}
