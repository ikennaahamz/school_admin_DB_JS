/**
 * Authentication, authorisation, and password hashing.
 *
 *     npm test
 *
 * The test that matters most here is "verifies a digest that was already in
 * the database". Decision D1 chose bcryptjs over Node's built-in scrypt
 * precisely so the 33 seeded users could be signed in to without a
 * re-seed. A hashing library that cannot read the existing rows would pass
 * every other test in this file and still leave the application unable to
 * log anyone in.
 */

import { describe, expect, it } from "vitest";

import {
  BCRYPT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  User,
  authenticate,
  describe as describeUser,
  hashPassword,
  lookupUser,
  passwordProblems,
  register,
  requireRole,
  verifyPassword,
  visibleRoleNames,
} from "@/lib/auth";
import { query } from "@/lib/db";
import { setUserStatus } from "@/lib/queries/users";

function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL || (process.env.DB_TARGET === "local" && process.env.LOCAL_DATABASE_URL));
}

describe("password hashing", () => {
  it("produces a cost-12 bcrypt digest", async () => {
    const digest = await hashPassword("Passw0rd!");
    expect(digest).toMatch(/^\$2[aby]\$12\$/);
    expect(BCRYPT_ROUNDS).toBe(12);
  });

  it("produces a different digest each time (salted)", async () => {
    const a = await hashPassword("Passw0rd!");
    const b = await hashPassword("Passw0rd!");
    expect(a).not.toBe(b);
  });

  it("round-trips a password", async () => {
    const digest = await hashPassword("Passw0rd!");
    expect(await verifyPassword("Passw0rd!", digest)).toBe(true);
    expect(await verifyPassword("passw0rd!", digest)).toBe(false);
  });

  it("fails closed on a malformed digest instead of throwing", async () => {
    expect(await verifyPassword("Passw0rd!", "not-a-bcrypt-digest")).toBe(false);
    expect(await verifyPassword("Passw0rd!", "")).toBe(false);
  });
});

describe.skipIf(!hasDatabase())("reads digests already in the database", () => {
  it("verifies a digest seeded by the Python application", async () => {
    // Every seeded account uses the demo password. If this fails, D1 was
    // the wrong choice and every login breaks.
    const rows = await query<{ username: string; password_hash: string }>(
      "SELECT username, password_hash FROM users WHERE status = 'active' ORDER BY user_id LIMIT 5",
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(await verifyPassword("Passw0rd!", row.password_hash)).toBe(true);
    }
  });

  it("signs in as the seeded administrator", async () => {
    const { user, message } = await authenticate("admin", "Passw0rd!");
    expect(user).not.toBeNull();
    expect(user?.username).toBe("admin");
    expect(user?.is_admin).toBe(true);
    expect(message).toMatch(/^Signed in as /);
  });

  it("gives an administrator access level 5", async () => {
    const { user } = await authenticate("admin", "Passw0rd!");
    expect(user?.access_level).toBe(5);
  });

  it("signs in a student whose access level is 1", async () => {
    const row = await query<{ username: string }>(
      "SELECT u.username FROM users u " +
        "JOIN user_roles ur ON ur.user_id = u.user_id " +
        "JOIN roles r ON r.role_id = ur.role_id " +
        "WHERE r.role_name = 'student' AND u.status = 'active' " +
        "ORDER BY u.user_id LIMIT 1",
    );
    const { user } = await authenticate(row[0].username, "Passw0rd!");
    expect(user?.roles).toContain("student");
    expect(user?.access_level).toBe(1);
  });
});

describe("anti-enumeration", () => {
  it("gives an identical message for an unknown user and a wrong password", async () => {
    // The message must not distinguish the two, or the login form becomes
    // a way to enumerate valid usernames.
    const wrongPassword = await authenticate("admin", "definitely-not-the-password");
    const noSuchUser = await authenticate("no_such_user_here", "Passw0rd!");

    expect(wrongPassword.user).toBeNull();
    expect(noSuchUser.user).toBeNull();
    expect(noSuchUser.message).toBe(wrongPassword.message);
    expect(wrongPassword.message).toBe("Incorrect username or password.");
  });

  it("rejects an empty username or password with its own message", async () => {
    expect((await authenticate("", "Passw0rd!")).message).toBe("Enter both a username and a password.");
    expect((await authenticate("admin", "")).message).toBe("Enter both a username and a password.");
  });

  it("lower-cases the username before looking it up", async () => {
    const { user } = await authenticate("  ADMIN  ", "Passw0rd!");
    expect(user?.username).toBe("admin");
  });
});

describe.skipIf(!hasDatabase())("account status", () => {
  it("refuses a pending account and says which status it is", async () => {
    // Creates its own pending account with a known password rather than
    // borrowing an arbitrary non-active row.
    //
    // The previous version did the borrowing, and it passed on the local
    // database while failing on Neon. Neon carries one extra account --
    // `george`, status pending -- left behind by a Python registration
    // test, and its password is not the seeded demo password. So
    // "SELECT ... WHERE status <> 'active' LIMIT 1" returned a row whose
    // password verification failed, and the assertion saw
    // "Incorrect username or password." instead of the status message.
    //
    // The two databases are not identical, and a test that depends on
    // ambient rows inherits their differences. Owning the fixture makes
    // this one behave the same on both.
    const username = `pending_${Date.now().toString(36).slice(-8)}`;

    try {
      const created = await register(username, `${username}@school.edu`, "Pending", "User", "Passw0rd!", "Passw0rd!");
      expect(created.ok).toBe(true);

      // Correct password, so the only thing left to refuse is the status.
      const { user, message } = await authenticate(username, "Passw0rd!");
      expect(user).toBeNull();
      expect(message).toContain("pending");
      expect(message).not.toBe("Incorrect username or password.");
    } finally {
      await query("DELETE FROM users WHERE username = $1", [username]);
    }
  }, 60_000);

  it("refuses a suspended account and says which status it is", async () => {
    // Suspended is reached by promoting an account, which needs a user to
    // suspend. `setUserStatus` is reversible, so this restores the
    // original status whatever happens.
    const row = (
      await query<{ user_id: number; username: string; status: string }>(
        "SELECT user_id, username, status::text AS status FROM users WHERE status = 'active' ORDER BY user_id LIMIT 1",
      )
    )[0];

    try {
      await setUserStatus(row.user_id, "suspended", "tester");

      const { user, message } = await authenticate(row.username, "Passw0rd!");
      expect(user).toBeNull();
      expect(message).toContain("suspended");
    } finally {
      await setUserStatus(row.user_id, row.status, "tester");
    }
  }, 60_000);
});

describe("password validation", () => {
  it("requires the minimum length", () => {
    expect(passwordProblems("a1", "a1").join(" ")).toContain(`at least ${MIN_PASSWORD_LENGTH}`);
  });

  it("requires the two entries to match", () => {
    expect(passwordProblems("Passw0rd!", "Passw0rd?").join(" ")).toContain("do not match");
  });

  it("requires a letter and a digit", () => {
    expect(passwordProblems("12345678", "12345678").join(" ")).toContain("one letter");
    expect(passwordProblems("abcdefgh", "abcdefgh").join(" ")).toContain("one digit");
  });

  it("accepts a compliant password", () => {
    expect(passwordProblems("Passw0rd!", "Passw0rd!")).toEqual([]);
  });
});

describe("role gating", () => {
  const student = Object.assign(new User({ user_id: 1, username: "s", email: "e", first_name: "A", last_name: "B" }), {
    roles: ["student"],
  });
  const admin = Object.assign(new User({ user_id: 2, username: "a", email: "e", first_name: "A", last_name: "B" }), {
    roles: ["admin"],
  });

  it("refuses a null user", () => {
    expect(requireRole(null, "admin")).toBe(false);
  });

  it("admits an administrator through every gate", () => {
    // By design: they manage the system. Must survive a refactor.
    expect(requireRole(admin, "admin")).toBe(true);
    expect(requireRole(admin, "registrar")).toBe(true);
    expect(requireRole(admin, "something_that_does_not_exist")).toBe(true);
  });

  it("admits a student only for their own role", () => {
    expect(requireRole(student, "student")).toBe(true);
    expect(requireRole(student, "registrar")).toBe(false);
  });

  it("describes the signed-in user for the sidebar", () => {
    expect(describeUser(null)).toBe("Not signed in");
    expect(describeUser(admin)).toBe("A B — admin");
  });
});

describe.skipIf(!hasDatabase())("lookup helpers", () => {
  it("lists role names ordered by access level, descending", async () => {
    const names = await visibleRoleNames();
    expect(names[0]).toBe("admin");
    expect(names).toContain("student");
  });

  it("fetches a user row by id", async () => {
    const row = await lookupUser(1);
    expect(row?.user_id).toBe(1);
    expect(row?.username).toBeTruthy();
  });

  it("returns null for a user that does not exist", async () => {
    expect(await lookupUser(999_999)).toBeNull();
  });
});

describe.skipIf(!hasDatabase())("registration", () => {
  it("creates a pending account with the student role", async () => {
    // Unique per run so repeated runs do not collide, and inside the
    // username CHECK ^[a-z0-9_.]{3,50}$.
    const suffix = Date.now().toString(36).slice(-8);
    const username = `testuser_${suffix}`;

    const result = await register(
      username,
      `${username}@school.edu`,
      "Test",
      "User",
      "Passw0rd!",
      "Passw0rd!",
    );

    // The delete is in a `finally` for the same reason as the grade test:
    // a failing assertion must not leave a row behind. See the note in
    // tests/queries.test.ts.
    try {
      expect(result.ok).toBe(true);

      const row = await lookupUser(
        Number(
          (
            await query<{ user_id: number }>("SELECT user_id FROM users WHERE username = $1", [username])
          )[0].user_id,
        ),
      );
      expect(row?.status).toBe("pending");

      const { user, message } = await authenticate(username, "Passw0rd!");
      // Correct password, but the account is not active yet.
      expect(user).toBeNull();
      expect(message).toContain("pending");
    } finally {
      await query("DELETE FROM users WHERE username = $1", [username]);
    }
  }, 60_000);

  it("refuses a duplicate username", async () => {
    const result = await register("admin", "new@school.edu", "A", "B", "Passw0rd!", "Passw0rd!");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already registered/);
  });

  it("rejects a malformed email", async () => {
    const result = await register("someone_new", "not-an-email", "A", "B", "Passw0rd!", "Passw0rd!");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/valid email/);
  });

  it("rejects a weak password before touching the database", async () => {
    const result = await register("someone_new", "new@school.edu", "A", "B", "short", "short");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/at least/);
  });
});
