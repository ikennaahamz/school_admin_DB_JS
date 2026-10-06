/**
 * Regression test for the `app.user` actor setting under connection pooling.
 *
 *     npm test
 *
 * Why this test exists
 * --------------------
 * `trg_audit_grade_change` records who entered a grade by reading
 * `current_setting('app.user', TRUE)`. The Python app wrote that setting
 * SESSION-SCOPED and was safe only because it opened and closed a fresh
 * connection per operation, so the setting could never outlive the
 * request that set it.
 *
 * This port uses a `pg.Pool`, which recycles connections. Had the line been
 * ported verbatim -- `set_config('app.user', $1, false)` -- the setting
 * would survive the transaction and the *previous* request's actor would be
 * stamped onto this request's `grade_audit` row. That is silent, it only
 * shows up under concurrency, and it would present as a data-integrity bug
 * in the report rather than as a bug in the port.
 *
 * `lib/db.ts` therefore sets it TRANSACTION-SCOPED
 * (`set_config('app.user', $1, true)`), which PostgreSQL discards at COMMIT
 * or ROLLBACK. These tests assert the behaviour, not the implementation:
 * they write grades with different actors and require that each audit row
 * names its own actor.
 *
 * What the session-scoped version actually breaks -- measured, not assumed
 * ---------------------------------------------------------------------
 * Flipping the third argument to `false` and re-running this file was the
 * check that justified the change, and the result is narrower than the
 * obvious reading of "the previous request's actor gets recorded":
 *
 *   The sequential actor tests PASS either way. Each write sets its own
 *   actor before the UPDATE runs, so the later actor simply overwrites the
 *   earlier one and every `grade_audit` row still looks correct. A test
 *   suite that only checked that would have shipped the bug.
 *
 *   What genuinely breaks is anything that runs on the connection WITHOUT
 *   setting an actor afterwards: the last test fails, reading
 *   'actor-three' where '' was expected. In the application that is any
 *   plain SELECT, and any write whose caller forgot to pass an actor --
 *   the trigger's `COALESCE(current_setting('app.user', TRUE),
 *   CURRENT_USER)` silently supplies the previous request's actor instead
 *   of falling back to the database role.
 *
 *   The second exposure needs concurrency rather than sequencing: two
 *   overlapping requests can interleave so that one request's set_config
 *   lands on the connection the other is about to use. That is
 *   intermittent by nature, which is why it is designed out here rather
 *   than tested for.
 *
 * Requires a reachable database; skipped otherwise so `npm test` still
 * passes on a fresh clone.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { exec, query, queryOne } from "@/lib/db";

/** True when a cloud DSN is configured. */
function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL || (process.env.DB_TARGET === "local" && process.env.LOCAL_DATABASE_URL));
}

type Enrollment = { enrollment_id: number; final_grade: string | null; status: string };

let target: Enrollment;

beforeAll(async () => {
  const rows = await query<Record<string, unknown>>(
    "SELECT enrollment_id, final_grade::text AS final_grade, status::text AS status " +
      "FROM enrollments ORDER BY enrollment_id LIMIT 1",
  );
  target = rows[0] as unknown as Enrollment;

  // Start from a known-clean session.
  //
  // `current_setting('app.user', TRUE)` falls back to any session-level
  // value already on the backend. The provider's pooler reuses server
  // sessions between clients, so residue from another process -- an older
  // deploy, the Python original, a psql session -- would otherwise make
  // the last test fail for reasons that have nothing to do with this code.
  // lib/db.ts clears it per connection; this makes the assertion explicit
  // rather than relying on that having run first.
  await query("SELECT set_config('app.user', '', false)");
});

afterAll(async () => {
  // Leave the row exactly as it was found. Restoring status matters: the
  // trigger sets it to 'completed'/'failed' whenever a grade is written.
  await exec(
    "UPDATE enrollments SET final_grade = $1::numeric, status = $2::enroll_status WHERE enrollment_id = $3",
    [target.final_grade, target.status, target.enrollment_id],
  );
});

describe.skipIf(!hasDatabase())("app.user does not leak across pooled requests", () => {
  it("stamps each grade with its own actor, not a previous one's", async () => {
    await exec("UPDATE enrollments SET final_grade = 71 WHERE enrollment_id = $1", [target.enrollment_id], "actor-one");

    const actor = await queryOne<string>(
      "SELECT changed_by FROM grade_audit WHERE enrollment_id = $1 ORDER BY audit_id DESC LIMIT 1",
      [target.enrollment_id],
    );
    expect(actor).toBe("actor-one");
  });

  it("does not let the next actor inherit the previous one", async () => {
    await exec("UPDATE enrollments SET final_grade = 83 WHERE enrollment_id = $1", [target.enrollment_id], "actor-two");

    const actor = await queryOne<string>(
      "SELECT changed_by FROM grade_audit WHERE enrollment_id = $1 ORDER BY audit_id DESC LIMIT 1",
      [target.enrollment_id],
    );
    expect(actor).toBe("actor-two");
  });

  it("writes exactly one audit row per grade change", async () => {
    const before = await queryOne<string>("SELECT count(*)::text FROM grade_audit");
    await exec("UPDATE enrollments SET final_grade = 64 WHERE enrollment_id = $1", [target.enrollment_id], "actor-three");
    const after = await queryOne<string>("SELECT count(*)::text FROM grade_audit");

    expect(Number(after) - Number(before)).toBe(1);

    const actor = await queryOne<string>(
      "SELECT changed_by FROM grade_audit WHERE enrollment_id = $1 ORDER BY audit_id DESC LIMIT 1",
      [target.enrollment_id],
    );
    expect(actor).toBe("actor-three");
  });

  it("leaves no app.user value behind for the next request", async () => {
    // The decisive assertion. Verified by flipping the third argument to
    // `false` and re-running: this then reads 'actor-three' instead of '',
    // because the setting outlives COMMIT and the next borrower inherits
    // it. Without it, the trigger's COALESCE fallback to CURRENT_USER
    // would quietly supply a stale actor instead of exposing the leak.
    //
    // Note the sequential actor assertions above pass either way, since
    // each write sets its own actor first. That is why this one exists.
    const leaked = await queryOne<string>("SELECT COALESCE(current_setting('app.user', TRUE), '')");
    expect(leaked).toBe("");
  });
});