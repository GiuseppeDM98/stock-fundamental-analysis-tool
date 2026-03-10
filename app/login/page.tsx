import { Suspense } from "react";
import LoginForm from "@/components/login-form";

export const metadata = { title: "Sign in – Stock Analysis" };

// LoginForm uses useSearchParams which requires Suspense boundary in Next.js 15.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
