// Declaration merge to add user.id to the Auth.js Session type.
// Without this, accessing session.user.id would require casting everywhere.
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
