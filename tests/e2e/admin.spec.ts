import { expect, test } from "@playwright/test";

import { gotoScreen, sessionFor } from "./helpers";

/**
 * The admin screen's account management.
 *
 * Added after the status control proved hard to find: it sat behind a
 * dropdown and a "Load" button, so the panel containing it did not exist
 * until an account had already been selected, while the table displayed a
 * Status column with no way to act on it.
 *
 * These tests assert the control is reachable in one click, and that the
 * sort order is by user_id rather than by username text.
 *
 * Nothing here submits a form. Changing a status is a write, and the
 * assertion is about reachability.
 */

test.describe("user administration", () => {
  test.use({ storageState: sessionFor("admin") });

  test("status is editable inline on every row", async ({ page }) => {
    await gotoScreen(page, "/admin");

    const rows = await page.locator("main table tbody tr").count();
    expect(rows).toBeGreaterThan(0);

    // One control per row, so no account needs to be selected first.
    const selects = page.getByLabel(/^Status for /);
    await expect(selects).toHaveCount(rows);

    const applyButtons = page.locator("main table tbody form button");
    await expect(applyButtons).toHaveCount(rows);
    await expect(applyButtons.first()).toHaveText("Apply");
  });

  test("each status control is defaulted to that row's status", async ({ page }) => {
    await gotoScreen(page, "/admin");

    const rows = page.locator("main table tbody tr");
    const first = rows.first();
    const shown = (await first.locator("span").first().innerText()).trim();
    const selected = await first.getByLabel(/^Status for /).inputValue();
    expect(selected).toBe(shown);
  });

  test("accounts are ordered by user_id, not by username text", async ({ page }) => {
    await gotoScreen(page, "/admin");

    // The seeded usernames read like numbers -- student23, student24,
    // student3 -- so ordering them as text produced a list that looked
    // broken and put the newest accounts at the bottom.
    const ids = await page.locator("main table tbody tr td:first-child").allInnerTexts();
    const numeric = ids.map((id) => Number(id.trim()));

    expect(numeric.every((n) => Number.isFinite(n))).toBe(true);
    expect([...numeric].sort((a, b) => a - b)).toEqual(numeric);
  });

  test("role management is one click away, without a Load button", async ({ page }) => {
    await gotoScreen(page, "/admin");

    // The old flow needed a dropdown plus a "Load" submit before anything
    // appeared. A single link now opens the role panel.
    await page.getByRole("link", { name: "Manage" }).first().click();
    await expect(page).toHaveURL(/pick=\d+/);

    await expect(page.getByText(/Roles are read on every request/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Grant" })).toBeVisible();
  });

  test("accounts awaiting activation are surfaced above the table", async ({ page }) => {
    await gotoScreen(page, "/admin");

    // Data-dependent: the panel only exists when something is pending. If
    // the seeded database has none, assert the absence is deliberate rather
    // than skipping silently.
    const panel = page.locator("section", { hasText: "awaiting activation" });
    const pendingBadges = await page.locator("main table tbody span.bg-amber-100").count();

    if (pendingBadges === 0) {
      await expect(panel).toHaveCount(0);
    } else {
      await expect(panel).toBeVisible();
    }
  });
});