import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // "server-only" isn't an installed package — Next.js resolves it via its own
      // bundler config to enforce the server/client boundary. Vitest has no such
      // boundary, so point it at a no-op stub instead of failing module resolution.
      "server-only": path.resolve(__dirname, "./vitest.server-only-stub.ts"),
    },
  },
  // tsconfig.json keeps "jsx": "preserve" for Next.js, which leaves JSX untransformed for
  // Vitest — component tests (.tsx) need the automatic runtime spelled out here instead.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // e2e/*.spec.ts are Playwright specs (`npm run e2e`), not Vitest suites.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
