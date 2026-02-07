import { DashboardClient } from "@/components/dashboard-client";

/**
 * Root page component for the stock analysis dashboard.
 *
 * This is a thin server component that delegates all UI logic to DashboardClient.
 * We keep this separate to enable server-side rendering of the page shell while
 * maintaining client-side interactivity for the dashboard itself.
 */
export default function HomePage() {
  return <DashboardClient />;
}
