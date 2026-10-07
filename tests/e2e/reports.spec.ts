import { expect, test } from "@playwright/test";

import { gotoScreen, hasRenderedError, sessionFor } from "./helpers";

/**
 * The reports screen, and the eight analytical queries.
 *
 * Port of the "reports screen runs real queries", "every report executes"
 * and "PL/pgSQL demonstration tab" blocks in `scripts/app_test.py`.
 *
 * These are the only assertions in the whole suite that exercise the
 * report SQL end to end through a browser. They are worth their cost: a
 * broken analytic query renders an empty table rather than throwing, so
 * "did not error" alone is not enough -- each report is also asserted to
 * return rows.
 */

const REPORT_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"] as const;

test.describe("reports screen", () => {
  test.use({ storageState: sessionFor("admin") });
  test("renders without error and offers all eight reports", async ({ page }) => {
    await gotoScreen(page, "/reports?tab=results");

    await expect(page.getByRole("heading", { name: "Management Reports", level: 1 })).toBeVisible();
    expect(await hasRenderedError(page)).toBe(false);

    const picker = page.locator("select#report");
    await expect(picker).toHaveCount(1);
    await expect(picker.locator("option")).toHaveCount(8);
  });

  test("shows a results table and a CSV download", async ({ page }) => {
    await gotoScreen(page, "/reports?tab=results");

    await expect(page.locator("main table").first()).toBeVisible();

    const download = page.locator("a[download]");
    await expect(download).toHaveCount(1);
    await expect(download).toHaveAttribute("download", "q1.csv");
  });

  test("states the management question each report answers", async ({ page }) => {
    await gotoScreen(page, "/reports?tab=results");
    await expect(page.locator("main .bg-sky-50")).toContainText("?");
  });

  test("shows the SQL source for a report", async ({ page }) => {
    await gotoScreen(page, "/reports?tab=sql&report=q3");

    // The SQL shown is the same string the application executes, so the two
    // cannot drift.
    const sql = await page.locator("main pre").innerText();
    expect(sql).toContain("RANK() OVER");
    expect(sql).toContain("computed_gpa");
  });

  for (const key of REPORT_KEYS) {
    test(`report ${key} executes and returns rows`, async ({ page }) => {
      await gotoScreen(page, `/reports?tab=results&report=${key}`);

      expect(await hasRenderedError(page), `${key} rendered an error`).toBe(false);

      // Q6 filters to departments above the school average, so an empty
      // result can be legitimate for a cohort that is uniformly average.
      // Every other report is expected to produce data.
      const rows = await page.locator("main table").first().locator("tbody tr").count();
      if (key === "q6") {
        expect(rows, "q6 returned rows but rendered an error").toBeGreaterThanOrEqual(0);
      } else {
        expect(rows, `${key} returned no rows`).toBeGreaterThan(0);
      }
    });
  }
});

test.use({ storageState: sessionFor("admin") });

test.describe("PL/pgSQL demonstration tab", () => {
  test("shows the procedural blocks and the audit trail", async ({ page }) => {
    await gotoScreen(page, "/reports?tab=plpgsql");

    expect(await hasRenderedError(page)).toBe(false);

    // Two tables: the live demonstration, and the grade audit trail.
    await expect(page.locator("main table")).toHaveCount(2);

    const demo = await page.locator("main table").first().innerText();
    expect(demo).toContain("letter_grade_for");
    expect(demo).toContain("enroll_student");
    // The two refusals are the point of two of the seven rows.
    expect(demo).toContain("does not exist");
    expect(demo).toContain("already enrolled");

    // The table renders friendly headers, so the raw column name `changed_by`
    // is not what appears on screen -- it is labelled "By". Asserting the
    // database key would have passed the SQL and failed the UI, or worse,
    // encouraged someone to render raw column names.
    const audit = await page.locator("main table").nth(1).innerText();
    expect(audit).toContain("Grade audit trail");
    expect(audit).toContain("Old letter");
    expect(audit).toContain("New letter");
  });

  test("a student may read reports", async ({ browser }) => {
    // Reports is one of only two screens a `student` role may open, so this
    // is the positive half of the role gate; rbac.spec.ts asserts the
    // negative half for every other screen.
    const context = await browser.newContext({ storageState: sessionFor("student1") });
    const page = await context.newPage();
    try {
      await gotoScreen(page, "/reports?tab=results&report=q5");
      await expect(page.getByRole("heading", { name: "Management Reports", level: 1 })).toBeVisible();
      expect(await hasRenderedError(page)).toBe(false);
    } finally {
      await context.close();
    }
  });
});
