/**
 * Setup project: signs the two fixture users in through the real /login form once and saves
 * their cookies as storageState, so specs start authenticated instead of logging in per test.
 * Sessions are JWT (Auth.js credentials provider), so the saved cookie is the whole session.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./support/test";
import { STORAGE_STATE } from "./support/env";
import { E2E_PASSWORD, USER_A, USER_B } from "./support/fixtures";

const IDENTITIES = [
  { user: USER_A, file: STORAGE_STATE.userA },
  { user: USER_B, file: STORAGE_STATE.userB },
];

test.use({ storageState: { cookies: [], origins: [] } });

for (const { user, file } of IDENTITIES) {
  test(`sign in as ${user.email}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The form does a full navigation to "/" on success; the session endpoint is the proof.
    await page.waitForURL((url) => url.pathname === "/");
    const session = await page.request.get("/api/auth/session").then((r) => r.json());
    expect(session?.user?.email).toBe(user.email);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.context().storageState({ path: file });
  });
}
