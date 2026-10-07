import { expect, test } from "@playwright/test";

import { gotoScreen, hasRenderedError, sessionFor } from "./helpers";

/**
 * Every screen renders, with real output.
 *
 * Port of the "every admin screen renders" block in `scripts/app_test.py`,
 * which asserted two things per screen: that it rendered without an
 * exception, and that it produced output.
 *
 * The Python version re-signed-in and re-selected the screen for each of
 * the nine. This navigates by URL instead, because each screen is a real
 * route with its own URL in Next.js -- which is the thing the port gained
 * and Streamlit did not have.
 */

const SCREENS = [
  { path: "/dashboard", heading: "Dashboard", expectsOutput: false },
  { path: "/students", heading: "Students", expectsOutput: true },
  { path: "/instructors", heading: "Instructors", expectsOutput: true },
  { path: "/sections", heading: "Courses & Sections", expectsOutput: true },
  { path: "/enrollments", heading: "Enrolments", expectsOutput: true },
  { path: "/assignments", heading: "Assignments & Submissions", expectsOutput: true },
  { path: "/attendance", heading: "Attendance", expectsOutput: true },
  { path: "/reports", heading: "Management Reports", expectsOutput: true },
  { path: "/admin", heading: "User Administration", expectsOutput: true },
] as const;

test.describe("every admin screen renders", () => {
  test.use({ storageState: sessionFor("admin") });
  test("dashboard renders and shows six metric tiles", async ({ page }) => {
    await gotoScreen(page, "/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    expect(await hasRenderedError(page)).toBe(false);

    // One tile per table_count() call, as in the Python dashboard.
    await expect(page.getByTestId("metric-tile")).toHaveCount(6);
    await expect(page.locator("main table").first()).toBeVisible();
  });

  for (const screen of SCREENS) {
    test(`${screen.path} renders`, async ({ page }) => {
      await gotoScreen(page, screen.path);

      await expect(page.getByRole("heading", { name: screen.heading, level: 1 })).toBeVisible();
      expect(await hasRenderedError(page), `${screen.path} rendered an error boundary`).toBe(false);

      if (screen.expectsOutput) {
        // A table or a form: proof the screen queried something rather
        // than rendering an empty shell.
        const produced = await page.locator("main table, main form").count();
        expect(produced, `${screen.path} produced no output`).toBeGreaterThan(0);
      }
    });
  }
});

test.describe("CRUD forms", () => {
  test.use({ storageState: sessionFor("admin") });
  test("sections screen offers the insert form", async ({ page }) => {
    // The Python assertion was `len(at.number_input) >= 1` on the sections
    // screen, which in practice was the insert tab.
    await gotoScreen(page, "/sections?tab=insert");

    await expect(page.getByRole("button", { name: "Insert section" })).toBeVisible();
    await expect(page.locator("main input[name=course_code]")).toBeVisible();
    await expect(page.locator("main input[name=academic_year]")).toHaveAttribute("type", "number");
    await expect(page.locator("main select[name=department_id]")).toHaveCount(0); // not on this form
    expect(await hasRenderedError(page)).toBe(false);
  });

  test("students screen offers all four tabs", async ({ page }) => {
    await gotoScreen(page, "/students");

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs).toHaveText(["View", "Insert", "Update", "Delete"]);
  });

  test("a tab is a real URL and survives a reload", async ({ page }) => {
    // st.tabs() was client-side state; a tab here is a link, so it can be
    // bookmarked and refreshed. That is a capability, not an implementation
    // detail, so it is worth asserting.
    await gotoScreen(page, "/students");
    await page.getByRole("tab", { name: "Insert" }).click();
    await expect(page).toHaveURL(/tab=insert/);

    await page.reload();
    await expect(page.getByRole("button", { name: "Insert student" })).toBeVisible();
  });
});
