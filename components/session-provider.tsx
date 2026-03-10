"use client";

// Next.js requires SessionProvider to be a client component.
// We wrap it here so layout.tsx can remain a server component.
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
