/**
 * Error translation and the identifier allowlists.
 *
 *     npm test
 *
 * Two things are asserted here, both of which the report makes claims
 * about:
 *
 *   1. PostgreSQL errors are translated into something worth showing a
 *      user, and the SQLSTATE is preserved alongside the message because
 *      that is the evidence an instructor wants next to the rule that was
 *      enforced. Python read `exc.pgcode`; node-postgres puts the same
 *      value in `err.code`, and getting that wrong would silently degrade
 *      every message to "SQLSTATE unknown".
 *
 *   2. `callProcedure` and `tableCount` refuse identifiers that are not on
 *      their allowlists. A procedure name and a table name cannot be bind
 *      values in SQL, so the allowlist is the whole defence -- if it were
 *      removed in favour of template interpolation, both functions would
 *      become injection points.
 *
 * Every statement below is written to violate a constraint on purpose.
 * The failure rolls its transaction back, so no data changes.
 */

import { describe, expect, it } from "vitest";

import { DatabaseError, callProcedure, exec, query, queryOne, tableCount } from "@/lib/db";

function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL || (process.env.DB_TARGET === "local" && process.env.LOCAL_DATABASE_URL));
}

describe.skipIf(!hasDatabase())("error translation", () => {
  it("names a unique violation as SQLSTATE 23505", async () => {
    // Point one user at another user's username so uq_users_username fires.
    const two = await query<{ user_id: number; username: string }>(
      "SELECT user_id, username FROM users ORDER BY user_id LIMIT 2",
    );
    await expect(
      exec("UPDATE users SET username = $1 WHERE user_id = $2", [two[1].username, two[0].user_id]),
    ).rejects.toThrow(/SQLSTATE 23505: unique_violation/);
  });

  it("names a foreign key violation as SQLSTATE 23503", async () => {
    await expect(
      exec("UPDATE enrollments SET student_id = $1 WHERE enrollment_id = (SELECT min(enrollment_id) FROM enrollments)", [
        999_999,
      ]),
    ).rejects.toThrow(/SQLSTATE 23503: foreign_key_violation/);
  });

  it("names a check violation as SQLSTATE 23514", async () => {
    // ck_users_username requires ^[a-z0-9_.]{3,50}$.
    await expect(
      exec("UPDATE users SET username = $1 WHERE user_id = (SELECT min(user_id) FROM users)", ["NOT VALID"]),
    ).rejects.toThrow(/SQLSTATE 23514: check_violation/);
  });

  it("reports a PL/pgSQL RAISE as its own message, not a generic error", async () => {
    // P0001 is what enroll_student raises, so the message the user reads
    // is the one written in the procedure rather than a wrapper.
    //
    // The duplicate guard is used rather than the capacity guard because it
    // is deterministic: re-enrolling an existing pair always raises,
    // whatever the section's spare seats. Relying on a section being full
    // would make this test mutate the database whenever capacity happened
    // to be available -- a test that writes is a test that can leave the
    // seeded data altered. Capacity refusal is covered instead by
    // db/migrations/verify_plpgsql.sql.
    const existing = await query<{ section_id: number; student_id: number }>(
      "SELECT section_id, student_id FROM enrollments WHERE status <> 'dropped' ORDER BY enrollment_id LIMIT 1",
    );

    await expect(callProcedure("enroll_student", [existing[0].student_id, existing[0].section_id], "tester")).rejects.toThrow(
      /already enrolled in section/,
    );
  });
});

describe("identifier allowlists", () => {
  it("tableCount rejects a table that is not on the allowlist", async () => {
    await expect(tableCount("pg_catalog")).rejects.toThrow(/not on the allowlist/);
  });

  it("tableCount refuses SQL injection through the table name", async () => {
    await expect(tableCount("users; DROP TABLE students")).rejects.toThrow(/not on the allowlist/);
  });

  it("callProcedure rejects a procedure that is not on the allowlist", async () => {
    await expect(callProcedure("drop_everything")).rejects.toThrow(/not on the allowlist/);
  });
});

describe.skipIf(!hasDatabase())("query shapes", () => {
  it("returns rows as objects keyed by column name", async () => {
    // Python used psycopg2's RealDictCursor for the same reason.
    const rows = await query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0].table_name).toBe("string");
  });

  it("returns a DATE as a plain YYYY-MM-DD string, not a JS Date", async () => {
    // node-postgres would otherwise parse it to local midnight, which
    // renders as the previous day anywhere west of UTC.
    const value = await queryOne<string>("SELECT DATE '2026-03-09'::date AS d");
    expect(value).toBe("2026-03-09");
  });

  it("returns NUMERIC as a string, so the table must compare it numerically", async () => {
    // Recorded deliberately: string "10" sorts before "9". The comparator
    // that handles this lives in components/DataTable.tsx.
    const value = await queryOne<string>("SELECT 10::numeric AS n");
    expect(typeof value).toBe("string");
  });

  it("reports a missing table with a DatabaseError", async () => {
    await expect(query("SELECT * FROM no_such_table")).rejects.toThrow(DatabaseError);
  });
});