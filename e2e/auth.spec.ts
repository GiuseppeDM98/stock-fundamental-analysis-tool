/**
 * Authentication flows, run logged out. Every outcome is checked against the HTTP layer or
 * the isolated database, not only the look of the page.
 */
import { test, expect } from "./support/test";
import { queryOne } from "./support/db";
import { E2E_PASSWORD, REGISTERED_EMAIL_PREFIX, USER_A } from "./support/fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

test("registers a fresh user through the UI, then signs in with it via /login", async ({ page }) => {
  const email = `${REGISTERED_EMAIL_PREFIX}${Date.now()}@example.test`;
  const password = "fresh-user-pass-1";

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/login\?registered=1/);
  // Client-side navigation: let the login page finish loading before typing into it.
  await page.waitForLoadState("networkidle");

  // The row must exist in the ISOLATED file — this is also the self-check that the dev
  // server writes where the suite thinks it does. The hash must be bcrypt, never plaintext.
  const row = await queryOne<{ passwordHash: string }>("SELECT passwordHash FROM User WHERE email = ?", [email]);
  expect(row, "registered user is in .e2e/e2e.db").not.toBeNull();
  expect(row!.passwordHash).toMatch(/^\$2[aby]\$/);
  expect(row!.passwordHash).not.toContain(password);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  const session = await page.request.get("/api/auth/session").then((r) => r.json());
  expect(session?.user?.email).toBe(email);
});

test("registering an existing email is refused with 409", async ({ request }) => {
  const res = await request.post("/api/auth/register", { data: { email: USER_A.email, password: "whatever-123" } });
  expect(res.status()).toBe(409);
});

test("a wrong password is rejected and no session is created", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_A.email);
  await page.getByLabel("Password").fill(`${E2E_PASSWORD}-wrong`);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  const session = await page.request.get("/api/auth/session").then((r) => r.json());
  expect(session?.user ?? null).toBeNull();
});

for (const path of ["/analyses", "/portfolio", "/watchlist", "/advisor", "/analyses/e2e_an_grounded"]) {
  test(`protected page ${path} redirects to /login when logged out`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
}
