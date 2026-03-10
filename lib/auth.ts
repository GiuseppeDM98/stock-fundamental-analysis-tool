// Auth.js v5 configuration.
// Uses credentials provider (email + bcrypt password) with JWT sessions.
// Custom pages: /login and /register handle the UI in the app's style.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import "@/types/auth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!valid) return null;

        return { id: user.id, email: user.email };
      },
    }),
  ],
  // JWT sessions: no session table needed in the database.
  session: { strategy: "jwt" },
  callbacks: {
    // Persist user.id in the JWT so we can access it in server components.
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    // Expose user.id on the session object for API routes and server components.
    session({ session, token }) {
      session.user.id = token.id as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
