import { auth } from "@/lib/auth";
import HubClient from "@/components/hub-client";

/**
 * Root route (`/`) — the adaptive Hub home.
 *
 * Renders for everyone (no redirect): logged-out visitors see the pipeline + CTAs.
 * `auth()` only gates the logged-in recent-activity strip, passed as the `isAuthed`
 * primitive so the session object never crosses into the client bundle.
 */
export default async function HomePage() {
  const session = await auth();
  return <HubClient isAuthed={!!session} />;
}
