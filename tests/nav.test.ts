/**
 * The screen registry's role predicate, and the flash transport.
 *
 *     npm test
 *
 * These are the two pieces of Phase 4 that can be tested without a server,
 * and both matter for more than tidiness.
 *
 * `canOpen` is the whole access-control decision. In the Python app the
 * equivalent was `_gate()` in the sidebar, which decided only what to
 * *draw* -- the module docstring itself said role checks happened "in the
 * presentation layer only as a convenience to the user". Here the same
 * predicate is enforced by `redirect()` before any query runs, so it needs
 * to be right in a way the old one did not have to be.
 *
 * `readFlash` parses values that arrived in a URL, which means they arrived
 * from whoever wrote the URL. It is the one place user-controlled text is
 * used to pick a rendering branch.
 */

import { describe, expect, it } from "vitest";

import { User } from "@/lib/auth";
import { readFlash, withFlash } from "@/lib/flash";
import { SCREENS, canOpen, screenByKey, visibleScreens } from "@/lib/nav";

function userWith(...roles: string[]): User {
  const user = new User({
    user_id: 1,
    username: "tester",
    email: "tester@school.edu",
    first_name: "Test",
    last_name: "User",
  });
  user.roles = roles;
  user.setAccessLevel(1);
  return user;
}

const admin = userWith("admin");
const registrar = userWith("registrar");
const instructor = userWith("instructor");
const student = userWith("student");
const technical = userWith("technical");
const nobody = userWith();

describe("the registry", () => {
  it("has the nine screens the Python app had", () => {
    expect(SCREENS).toHaveLength(9);
    expect(SCREENS.map((s) => s.key)).toEqual([
      "dashboard",
      "students",
      "instructors",
      "sections",
      "enrollments",
      "assignments",
      "attendance",
      "reports",
      "admin",
    ]);
  });

  it("gives every screen a unique href", () => {
    const hrefs = SCREENS.map((s) => s.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("looks a screen up by key, and returns undefined for an unknown key", () => {
    expect(screenByKey("reports")?.label).toBe("Reports");
    expect(screenByKey("nope")).toBeUndefined();
  });
});

describe("an empty roles list means no restriction", () => {
  it("admits every signed-in user to the dashboard, including one with no roles", () => {
    const dashboard = screenByKey("dashboard")!;
    expect(dashboard.roles).toEqual([]);
    expect(canOpen(admin, dashboard)).toBe(true);
    expect(canOpen(student, dashboard)).toBe(true);
    expect(canOpen(nobody, dashboard)).toBe(true);
  });

  it("never admits a signed-out visitor, not even to the dashboard", () => {
    expect(canOpen(null, screenByKey("dashboard")!)).toBe(false);
  });
});

describe("role gating", () => {
  it("restricts User Admin to administrators", () => {
    const adminScreen = screenByKey("admin")!;
    expect(canOpen(admin, adminScreen)).toBe(true);
    expect(canOpen(registrar, adminScreen)).toBe(false);
    expect(canOpen(instructor, adminScreen)).toBe(false);
    expect(canOpen(student, adminScreen)).toBe(false);
  });

  it("restricts Students and Instructors to admin and registrar", () => {
    for (const key of ["students", "instructors"]) {
      const screen = screenByKey(key)!;
      expect(canOpen(admin, screen)).toBe(true);
      expect(canOpen(registrar, screen)).toBe(true);
      expect(canOpen(instructor, screen)).toBe(false);
      expect(canOpen(student, screen)).toBe(false);
    }
  });

  it("admits instructors to the teaching screens", () => {
    for (const key of ["sections", "enrollments", "assignments", "attendance"]) {
      expect(canOpen(instructor, screenByKey(key)!)).toBe(true);
      expect(canOpen(student, screenByKey(key)!)).toBe(false);
    }
  });

  it("lets an administrator through every gate", () => {
    // The documented intent: administrators manage the system. Asserted
    // across the whole registry so a refactor cannot quietly drop it.
    for (const screen of SCREENS) {
      expect(canOpen(admin, screen)).toBe(true);
    }
  });

  it("gives a student only Dashboard and Reports", () => {
    // Handoff §8 acceptance item 4.
    expect(visibleScreens(student).map((s) => s.key)).toEqual(["dashboard", "reports"]);
  });

  it("gives an administrator all nine screens", () => {
    // Handoff §8 acceptance item 3.
    expect(visibleScreens(admin)).toHaveLength(9);
  });

  it("gives a registrar seven screens -- everything but User Admin", () => {
    // `registrar` is listed on students, instructors, the four teaching
    // screens and reports, and the dashboard is unrestricted. Only User
    // Admin excludes it.
    expect(visibleScreens(registrar).map((s) => s.key)).toEqual([
      "dashboard",
      "students",
      "instructors",
      "sections",
      "enrollments",
      "assignments",
      "attendance",
      "reports",
    ]);
  });

  it("gives an instructor the dashboard, teaching screens and reports", () => {
    expect(visibleScreens(instructor).map((s) => s.key)).toEqual([
      "dashboard",
      "sections",
      "enrollments",
      "assignments",
      "attendance",
      "reports",
    ]);
  });

  it("shows `technical` only the dashboard, because no screen lists it", () => {
    // The Python registry had the same gap: `technical` is a seeded role
    // with an access level, but no screen names it. Recorded rather than
    // papered over -- `i.koc` reaches the teaching screens through the
    // `instructor` role they also hold.
    expect(visibleScreens(technical).map((s) => s.key)).toEqual(["dashboard"]);
  });

  it("shows nothing to a signed-out visitor", () => {
    expect(visibleScreens(null)).toEqual([]);
  });
});

describe("flash transport", () => {
  it("round-trips a message through the query string", () => {
    const url = withFlash("/dashboard", "success", "Signed in as Ada Lovelace (admin).");
    const params = Object.fromEntries(new URL(url, "http://x").searchParams);
    expect(readFlash(params)).toEqual({ kind: "success", message: "Signed in as Ada Lovelace (admin)." });
  });

  it("appends to a path that already has a query string", () => {
    const url = withFlash("/reports?tab=q5", "info", "Loaded.");
    expect(url.startsWith("/reports?tab=q5&")).toBe(true);
    expect(Object.fromEntries(new URL(url, "http://x").searchParams)).toMatchObject({ tab: "q5", flash: "info" });
  });

  it("truncates a very long message rather than dropping it", () => {
    const long = "x".repeat(2000);
    const flash = readFlash(Object.fromEntries(new URL(withFlash("/x", "error", long), "http://x").searchParams));
    expect(flash).not.toBeNull();
    expect(flash!.message.length).toBeLessThanOrEqual(500);
    expect(flash!.message.endsWith("…")).toBe(true);
  });

  it("returns null when either parameter is missing", () => {
    expect(readFlash({})).toBeNull();
    expect(readFlash({ flash: "success" })).toBeNull();
    expect(readFlash({ msg: "hello" })).toBeNull();
  });

  it("rejects a kind that is not one of the four", () => {
    // The kind picks the banner's CSS class, so it is validated rather
    // than interpolated.
    expect(readFlash({ flash: "<script>", msg: "hi" })).toBeNull();
    expect(readFlash({ flash: "SUCCESS", msg: "hi" })).toBeNull();
    expect(readFlash({ flash: "", msg: "hi" })).toBeNull();
  });

  it("rejects an empty message", () => {
    expect(readFlash({ flash: "info", msg: "" })).toBeNull();
  });

  it("accepts each of the four kinds", () => {
    for (const kind of ["success", "error", "warning", "info"]) {
      expect(readFlash({ flash: kind, msg: "m" })?.kind).toBe(kind);
    }
  });

  it("preserves newlines, so a database error stays readable", () => {
    const flash = readFlash({ flash: "error", msg: "line one\nline two" });
    expect(flash?.message).toContain("\n");
  });
});
