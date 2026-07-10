// No-op stand-in for the "server-only" package (not an installed dependency —
// Next.js resolves the real import via its own bundler config). Aliased in
// vitest.config.ts so tests can import modules that start with `import "server-only"`.
export {};
