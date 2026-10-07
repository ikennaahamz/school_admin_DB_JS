import { expect, type Page } from "@playwright/test";
import path from "node:path";

import { statePath, type Role } from "./global-setup";

/**
 * Shared helpers for the end-to-end suite.
 *
 * Port of the small helpers at the top of `scripts/app_test.py`
 * (`fresh()` and `sign_in()`).
 *
 * Two differences are worth noting.
 *
 * The Python `sign_in()` staged both text inputs and clicked submit *before*
 * a single `run()`, because calling `run()` in between consumed the staged
 * value and reset the widget. That is a Streamlit testing-harness quirk with
 * no Playwright equivalent -- a real browser keeps typed values across a form
 * submit, which is what a user gets.
 *
 * And most tests do not sign in at all: they restore a cookie captured once
 * per role by the global setup, because bcryptjs blocks the server's event
 * loop and forty parallel hashes make it look hung. Only the tests that are
 * *about* signing in do the real thing.
 */

export const DEMO_PASSWORD = "Passw0rd!";

/**
 * Navigate to a screen.
 *
 * `domcontentloaded` rather than Playwright's default `load`, and that is
 * not a stylistic choice. The `load` event waits for every subresource,
 * and the root layout loads webfonts from Google Fonts. Where that request
 * is slow or blocked -- as it is in this environment -- `load` never fires,
 * and a page that has in fact rendered perfectly reports as blank.
 *
 * Waiting for the element a test actually cares about is the recommended
 * pattern anyway, and it decouples the assertions from third-party
 * requests the application does not control.
 */
export async function gotoScreen(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

/**
 * The cached cookie state for a role, for use with `test.use({ storageState })`.
 *
 * Cannot be wrapped in a helper that calls `test.use` internally, because
 * `test.use` is only valid at module or describe scope. Specs call it
 * directly:
 *
 *     test.use({ storageState: sessionFor("admin") });
 */
export function sessionFor(role: Role): string {
  return path.resolve(statePath(role));
}

/** Sign in for real, and wait for the dashboard. */
export async function signIn(page: Page, username: string, password = DEMO_PASSWORD): Promise<void> {
  await gotoScreen(page, "/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** The navigation entries the sidebar shows for the signed-in user. */
export async function navLabels(page: Page): Promise<string[]> {
  return page.locator("nav[aria-label='Screens'] a").allInnerTexts();
}

/** True when the page rendered Next.js's error boundary rather than the screen. */
export async function hasRenderedError(page: Page): Promise<boolean> {
  const body = await page.locator("body").innerText();
  return /Application error|Internal Server Error|This .* could not be found/i.test(body);
}
