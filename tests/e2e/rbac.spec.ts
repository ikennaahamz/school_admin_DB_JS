import { expect, test } from "@playwright/test";

import { gotoScreen, navLabels, sessionFor } from "./helpers";

/**
 * Role-based gating, asserted against the rendered sidebar and the guard.
 *
 * Port of the "role gating" block in `scripts/app_test.py`, whose expected
 * counts came from the `SCREENS` list in `app.py`:
 *
 *   dashboard + reports ......... everyone
 *   students, instructors ...... admin, registrar
 *   courses, enrolments,
 *   assignments, attendance .... admin, registrar, instructor
 *   user admin ................. admin only
 *
 * The Python suite counted entries in a Streamlit radio widget. This counts
 * the links the server actually rendered, which additionally proves the
 * filtering happened server-side rather than in the browser -- and then
 * checks the guard separately by requesting pages that should be refused.
 *
 * The same predicate is unit-tested in `tests/nav.test.ts`. That overlap is
 * deliberate: the unit test pins the rule, this one proves the rule is wired
 * to both the navigation and the redirect.
 */

test.describe("admin", () => {
  test.use({ storageState: sessionFor("admin") });

  test("sees all nine screens", async ({ page }) => {
    await gotoScreen(page, "/dashboard");
    const labels = (await navLabels(page)).map((l) => l.trim());
    expect(labels).toHaveLength(9);
    expect(labels).toContain("User Admin");
    expect(labels).toContain("Students");
    expect(labels).toContain("Courses");
  });
});

test.describe("student", () => {
  test.use({ storageState: sessionFor("student1") });

  test("sees exactly two screens", async ({ page }) => {
    await gotoScreen(page, "/dashboard");
    const sidebar = page.locator("aside");
    await expect(sidebar).toContainText("• student");
    await expect(sidebar).toContainText("level 1");

    expect((await navLabels(page)).map((l) => l.trim())).toEqual(["Dashboard", "Reports"]);
  });

  test("cannot reach an admin-only screen", async ({ page }) => {
    // The sidebar hiding a link is a convenience. This is the control that
    // matters: the request is refused before any query runs.
    for (const path of [
      "/admin",
      "/students",
      "/instructors",
      "/sections",
      "/enrollments",
      "/assignments",
      "/attendance",
    ]) {
      await gotoScreen(page, path);
      await expect(page, `${path} must not render for a student`).toHaveURL(/\/dashboard/);
    }
  });

  test("can still read reports", async ({ page }) => {
    await gotoScreen(page, "/reports");
    await expect(page.getByRole("heading", { name: "Management Reports", level: 1 })).toBeVisible();
  });
});

test.describe("instructor", () => {
  test.use({ storageState: sessionFor("i.kaya") });

  test("sees exactly six screens", async ({ page }) => {
    await gotoScreen(page, "/dashboard");
    const labels = (await navLabels(page)).map((l) => l.trim());

    expect(labels).toHaveLength(6);
    expect(labels).toContain("Courses");
    expect(labels).not.toContain("User Admin");
    expect(labels).not.toContain("Students");
  });

  test("is refused the registrar-only screens", async ({ page }) => {
    for (const path of ["/admin", "/students", "/instructors"]) {
      await gotoScreen(page, path);
      await expect(page, `${path} must not render for an instructor`).toHaveURL(/\/dashboard/);
    }
  });
});

test.describe("registrar", () => {
  test.use({ storageState: sessionFor("registrar") });

  test("sees exactly eight screens", async ({ page }) => {
    await gotoScreen(page, "/dashboard");
    const labels = (await navLabels(page)).map((l) => l.trim());
    expect(labels).toHaveLength(8);
    expect(labels).not.toContain("User Admin");
  });

  test("may reach student records but not user admin", async ({ page }) => {
    await gotoScreen(page, "/students");
    await expect(page.getByRole("heading", { name: "Students", level: 1 })).toBeVisible();

    await gotoScreen(page, "/admin");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("anonymous", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is redirected from every protected screen", async ({ page }) => {
    for (const path of ["/dashboard", "/students", "/admin", "/reports", "/attendance"]) {
      await gotoScreen(page, path);
      await expect(page, `${path} must not render without a session`).toHaveURL(/\/login/);
    }
  });
});
