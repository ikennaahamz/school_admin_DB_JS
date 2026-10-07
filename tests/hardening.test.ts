/**
 * Prove `hardening.sql` is safe: it must not break the application.
 *
 *     npm test
 *
 * Port of `scripts/verify_hardening.py`, which asserted nine things:
 *
 *   1. apply_all.sql builds a fresh database
 *   2. students queryable before hardening
 *   3. hardening.sql applies cleanly
 *   4. students queryable after hardening
 *   5-8. users, enrollments, course_sections and grade_audit still
 *        queryable as the table owner
 *   9. a PL/pgSQL function still callable
 *
 * Why the test exists at all, given hardening.sql is marked OPTIONAL and
 * is not part of the schema: it is the one file that revokes privileges,
 * and a mistake in it would silently break the application rather than
 * fail loudly. The claim being checked is that revoking grants from `anon`
 * and `authenticated` leaves every owner-level query working, because the
 * application connects as the owner.
 *
 * It builds a throwaway database rather than touching the configured one,
 * and drops it afterwards. Creating a database needs privileges a pooled or
 * managed connection usually withholds, so the suite is skipped unless
 * DB_TARGET is local.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { normaliseDsn, resolveDsn } from "@/lib/db";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRATCH = "school_hardening_test";

function canCreateDatabases(): boolean {
  return (process.env.DB_TARGET ?? "").toLowerCase() === "local";
}

function urlForDatabase(name: string): string {
  const url = new URL(normaliseDsn(resolveDsn()));
  url.pathname = `/${name}`;
  return url.toString();
}

describe.skipIf(!canCreateDatabases())("hardening.sql does not break the application", () => {
  let scratch: Client;
  let studentsBefore: string;

  beforeAll(async () => {
    const admin = new Client({ connectionString: urlForDatabase("postgres") });
    await admin.connect();
    // A fresh database every run: leftovers from a previous run would make
    // "applies cleanly" mean nothing.
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${SCRATCH}`);
    await admin.end();

    scratch = new Client({ connectionString: urlForDatabase(SCRATCH) });
    await scratch.connect();
  }, 180_000);

  afterAll(async () => {
    try {
      await scratch?.end();
      const cleanup = new Client({ connectionString: urlForDatabase("postgres") });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      await cleanup.end();
    } catch {
      // A leftover scratch database is untidy, not harmful.
    }
  }, 60_000);

  it("apply_all.sql builds a fresh database", async () => {
    await scratch.query(readFileSync(path.join(ROOT, "db", "apply_all.sql"), "utf8"));

    const tables = await scratch.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tables.rows[0].n).toBeGreaterThanOrEqual(13);
  }, 180_000);

  it("students are queryable before hardening", async () => {
    const result = await scratch.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM students");
    expect(result.rows[0].n).toMatch(/^\d+$/);
    studentsBefore = result.rows[0].n;
  });

  it("hardening.sql applies cleanly", async () => {
    // The DO block reports 'does not exist here, skipping' for the `anon`
    // and `authenticated` roles, which plain PostgreSQL does not have.
    // That is the expected path, not a failure.
    await scratch.query(readFileSync(path.join(ROOT, "db", "hardening.sql"), "utf8"));
  });

  it("students are queryable after hardening", async () => {
    const result = await scratch.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM students");
    expect(result.rows[0].n).toBe(studentsBefore);
  });

  for (const table of ["users", "enrollments", "course_sections", "grade_audit"]) {
    it(`${table} is still queryable as the owner`, async () => {
      const result = await scratch.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${table}`);
      expect(result.rows[0].n).toMatch(/^\d+$/);
    });
  }

  it("a PL/pgSQL function is still callable", async () => {
    const result = await scratch.query<{ letter: string }>("SELECT letter_grade_for(93)::text AS letter");
    expect(result.rows[0].letter).toBe("AA");
  });
});
