import { expect, test } from "@playwright/test";

import { DEMO_PASSWORD, gotoScreen, navLabels, signIn } from "./helpers";

/**
 * Login: the sign-in screen, rejected credentials, and a successful sign-in.
 *
 * Port of the "login screen", "rejected credentials" and "successful login"
 * blocks in `scripts/app_test.py`.
 */

test.describe("login screen", () => {
  test("renders without error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await gotoScreen(page, "/login");
    await expect(page.getByRole("heading", { name: "School Administration System" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("shows the sign-in heading", async ({ page }) => {
    await gotoScreen(page, "/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("has username and password fields", async ({ page }) => {
    await gotoScreen(page, "/login");
    await expect(page.locator("#username")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
  });

  test("password field is masked", async ({ page }) => {
    // The Python original could not assert this: AppTest does not expose
    // whether a field is masked, so it counted `type="password"` in the
    // source text instead. Asserting the rendered attribute is strictly
    // stronger -- it proves the browser is actually masking the field,
    // not merely that the markup mentions it once.
    await gotoScreen(page, "/login");
    await expect(page.locator("#password")).toHaveAttribute("type", "password");
    await expect(page.locator("form:has(#username) input[name=password]")).toHaveCount(1);
  });

  test("redirects an anonymous visitor away from a protected page", async ({ page }) => {
    await gotoScreen(page, "/students");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("rejected credentials", () => {
  test("a wrong password does not sign in", async ({ page }) => {
    await gotoScreen(page, "/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // Still on the login page, and no session was created.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("main [role=alert]")).toContainText("Incorrect username or password.");
  });

  test("an unknown username is refused identically", async ({ page }) => {
    // The two messages must be indistinguishable, or the form becomes a way
    // to enumerate valid usernames.
    await gotoScreen(page, "/login");
    await page.locator("#username").fill("no_such_user_at_all");
    await page.locator("#password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.locator("main [role=alert]")).toContainText("Incorrect username or password.");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("successful login", () => {
  test("establishes an admin session with the right role and level", async ({ page }) => {
    await signIn(page, "admin");

    const sidebar = page.locator("aside");
    await expect(sidebar).toContainText("System Administrator");
    await expect(sidebar).toContainText("• admin");
    await expect(sidebar).toContainText("level 5");
  });

  test("shows the navigation and a sign-out control", async ({ page }) => {
    await signIn(page, "admin");

    await expect(page.locator("nav[aria-label='Screens']")).toBeVisible();
    expect((await navLabels(page)).length).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("lands on the dashboard by default", async ({ page }) => {
    await signIn(page, "admin");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  });

  test("signing out clears the session", async ({ page }) => {
    await signIn(page, "admin");
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login/);
    // And the session is genuinely gone, not just hidden.
    await gotoScreen(page, "/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
