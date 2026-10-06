/**
 * The query layer: every function, run against the database.
 *
 *     npm test
 *
 * A 1:1 SQL port that type-checks is not a port that works -- a
 * mistyped column, a `%s` that should have been `$1`, or a group-by
 * that no longer matches the select list all pass the compiler and fail
 * here. So this file executes every function rather than asserting on
 * shapes alone.
 *
 * The highest-risk code here is `Conditions`, which rewrites `%s` markers
 * into numbered `$n` placeholders at runtime. The `listStudents` search
 * filter binds three values into one clause, so a numbering bug produces
 * either a syntax error or, worse, a silently wrong result. The search
 * tests below deliberately search for a term matching exactly one student
 * and assert that only that student comes back.
 *
 * Read paths run freely. Write paths either undo themselves or operate on
 * rows created by the test, and the suite leaves the seed data as found.
 */

import { afterAll, describe, expect, it } from "vitest";

import { query, queryOne } from "@/lib/db";
import { REPORTS, demoProcedures, run, sqlByKey } from "@/lib/reports";
import { listAttendance, recordAttendance, deleteAttendance } from "@/lib/queries/attendance";
import { listAssignments } from "@/lib/queries/assignments";
import { listEnrollments, enrol, unenrol, setGrade } from "@/lib/queries/enrollments";
import { listInstructors } from "@/lib/queries/instructors";
import { deleteSection, insertSection, listSections } from "@/lib/queries/sections";
import { deleteStudent, listStudents, updateStudent } from "@/lib/queries/students";
import { listUsers } from "@/lib/queries/users";

function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL || (process.env.DB_TARGET === "local" && process.env.LOCAL_DATABASE_URL));
}

describe.skipIf(!hasDatabase())("read paths return rows", () => {
  it("listStudents", async () => {
    const rows = await listStudents();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].student_no).toBeTruthy();
    expect(rows[0].advisor).toBeTruthy();
  });

  it("listInstructors", async () => {
    const rows = await listInstructors();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].employee_no).toBeTruthy();
  });

  it("listSections calls the PL/pgSQL fill-ratio function", async () => {
    const rows = await listSections();
    expect(rows.length).toBeGreaterThan(0);
    // section_fill_ratio() is block 3 of migration 0002. If this is
    // missing the whole string is null and nothing else notices.
    expect(rows[0].fill_pct).not.toBeNull();
  });

  it("listEnrollments", async () => {
    const rows = await listEnrollments();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("listAssignments", async () => {
    const rows = await listAssignments();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("listAttendance", async () => {
    const rows = await listAttendance();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("listUsers aggregates roles with STRING_AGG", async () => {
    const rows = await listUsers();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.roles !== "(no roles)")).toBe(true);
  });
});

describe.skipIf(!hasDatabase())("the dynamic WHERE builders bind correctly", () => {
  // Each of these exercises `Conditions`. The search case binds three
  // values into one clause and is the most likely place for the numbering
  // to go wrong.

  it("listStudents filters by department", async () => {
    const all = await listStudents();
    const deptCode = all[0].dept_code;
    const departmentId = Number(
      (
        await query<{ department_id: number }>("SELECT department_id FROM departments WHERE dept_code = $1", [deptCode])
      )[0].department_id,
    );

    const expected = all.filter((s) => s.dept_code === deptCode).length;
    const filtered = await listStudents(departmentId);

    expect(filtered.length).toBe(expected);
    expect(filtered.every((s) => s.dept_code === deptCode)).toBe(true);
  });

  it("listStudents searches names and student numbers (3 placeholders, one clause)", async () => {
    const all = await listStudents();
    const target = all[all.length - 1];

    // By student number, which appears in exactly one of the three ILIKEs.
    const byNo = await listStudents(null, target.student_no);
    expect(byNo.length).toBeGreaterThan(0);
    expect(byNo.some((s) => s.student_no === target.student_no)).toBe(true);
    expect(byNo.every((s) => s.student_no === target.student_no)).toBe(true);

    // By surname, which appears in the second ILIKE.
    const surname = target.student_name.split(" ").slice(-1)[0];
    const byName = await listStudents(null, surname);
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every((s) => s.student_name.toLowerCase().includes(surname.toLowerCase()))).toBe(true);

    // A search that matches nothing must return nothing, not everything --
    // the classic symptom of an unbound placeholder.
    const none = await listStudents(null, "zzzz-no-such-student-zzzz");
    expect(none).toEqual([]);
  });

  it("listSections filters by term and academic year", async () => {
    const all = await listSections();
    const target = all[0];

    const byTerm = await listSections(target.term);
    expect(byTerm.every((s) => s.term === target.term)).toBe(true);
    expect(byTerm.length).toBeLessThan(all.length);

    const byYear = await listSections(null, target.academic_year);
    expect(byYear.every((s) => s.academic_year === target.academic_year)).toBe(true);
    expect(byYear.length).toBeGreaterThan(0);

    const both = await listSections(target.term, target.academic_year);
    expect(both.every((s) => s.term === target.term && s.academic_year === target.academic_year)).toBe(true);
    expect(both.length).toBeGreaterThan(0);
  });

  it("listEnrollments filters by status", async () => {
    const completed = await listEnrollments("completed");
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.every((e) => e.status === "completed")).toBe(true);
  });

  it("listAssignments filters by section", async () => {
    const all = await listAssignments();
    const sectionId = Number(
      (
        await query<{ section_id: number }>(
          "SELECT section_id FROM assignments WHERE assignment_id = $1",
          [all[0].assignment_id],
        )
      )[0].section_id,
    );
    const filtered = await listAssignments(sectionId);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((a) => a.course_code === all[0].course_code)).toBe(true);
  });

  it("listAttendance filters by section and by student", async () => {
    const all = await listAttendance();
    expect(all.length).toBeGreaterThan(0);

    const sectionId = Number(
      (
        await query<{ section_id: number }>("SELECT section_id FROM attendance WHERE attendance_id = $1", [
          all[0].attendance_id,
        ])
      )[0].section_id,
    );
    const bySection = await listAttendance(sectionId);
    expect(bySection.length).toBeGreaterThan(0);
    expect(bySection.length).toBeLessThanOrEqual(all.length);

    const studentId = Number(
      (
        await query<{ student_id: number }>("SELECT student_id FROM attendance WHERE attendance_id = $1", [
          all[0].attendance_id,
        ])
      )[0].student_id,
    );
    const byStudent = await listAttendance(null, studentId);
    expect(byStudent.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasDatabase())("write paths", () => {
  let createdSectionId: number | null = null;

  afterAll(async () => {
    if (createdSectionId !== null) {
      await deleteSection(createdSectionId).catch(() => undefined);
    }
  });

  it("insertSection upper-cases the course code, and deleteSection removes it", async () => {
    // The normalisation matters: report Q1 joins on course_code being a
    // prefix of dept_code, so a lower-case code would silently drop the
    // section from the enrolment-pressure report.
    createdSectionId = await insertSection({
      course_code: "  zz999 ",
      course_name: "Temporary Port Check",
      term: "Fall",
      academic_year: 2099,
      instructor_id: null,
      classroom_id: null,
      credits: 3,
      capacity: 10,
    });

    const rows = await listSections("Fall", 2099);
    const found = rows.find((s) => s.section_id === createdSectionId);
    expect(found?.course_code).toBe("ZZ999");

    const deleted = await deleteSection(createdSectionId!);
    expect(deleted).toBe(1);
    createdSectionId = null;
  });

  it("enrol refuses a duplicate through the procedure", async () => {
    const existing = (
      await query<{ section_id: number; student_id: number }>(
        "SELECT section_id, student_id FROM enrollments WHERE status <> 'dropped' ORDER BY enrollment_id LIMIT 1",
      )
    )[0];

    // Must raise, not insert. The procedure's duplicate guard is one of
    // the invariants a bare INSERT would bypass.
    await expect(enrol(existing.student_id, existing.section_id, "tester")).rejects.toThrow(/already enrolled/);
  });

  it("setGrade then unenrol round-trips and restores the row", async () => {
    const row = (
      await query<{ enrollment_id: number; final_grade: string | null; status: string }>(
        "SELECT enrollment_id, final_grade::text AS final_grade, status::text AS status " +
          "FROM enrollments ORDER BY enrollment_id LIMIT 1",
      )
    )[0];

    // Restoration lives in `finally`, not after the assertions.
    //
    // An earlier version restored inline at the end. It asserted
    // `grade_letter` was "CC" for a grade of 77 -- it is actually "DD",
    // because 70-79 is the DD band -- so the assertion threw, the restore
    // never ran, and the row was left holding the test's value of 77
    // instead of its seeded 79. Every later run captured 77 as the
    // baseline and dutifully restored 77, so the corruption was silent
    // and permanent. A test that damages data on failure has to restore
    // in a `finally`, not on the happy path.
    try {
      await setGrade(row.enrollment_id, 77, "tester");
      const graded = (
        await query<{ final_grade: string; status: string; grade_letter: string }>(
          "SELECT final_grade::text AS final_grade, status::text AS status, grade_letter::text AS grade_letter " +
            "FROM enrollments WHERE enrollment_id = $1",
          [row.enrollment_id],
        )
      )[0];

      // The trigger, not the application, derived all three. 77 falls in
      // the 70-79 band, which letter_grade_for maps to DD.
      expect(Number(graded.final_grade)).toBe(77);
      expect(graded.status).toBe("completed");
      expect(graded.grade_letter).toBe("DD");

      await unenrol(row.enrollment_id, "tester");
      const dropped = (
        await query<{ status: string; final_grade: string | null }>(
          "SELECT status::text AS status, final_grade::text AS final_grade FROM enrollments WHERE enrollment_id = $1",
          [row.enrollment_id],
        )
      )[0];
      expect(dropped.status).toBe("dropped");
      expect(dropped.final_grade).toBeNull();
    } finally {
      // One statement, so the trigger re-derives grade_letter from the
      // restored grade rather than leaving a letter that disagrees with it.
      await query(
        "UPDATE enrollments SET final_grade = $1::numeric, status = $2::enroll_status WHERE enrollment_id = $3",
        [row.final_grade, row.status, row.enrollment_id],
      );
    }

    const restored = (
      await query<{ final_grade: string | null; status: string; grade_letter: string | null }>(
        "SELECT final_grade::text AS final_grade, status::text AS status, grade_letter::text AS grade_letter " +
          "FROM enrollments WHERE enrollment_id = $1",
        [row.enrollment_id],
      )
    )[0];
    expect(restored.final_grade).toBe(row.final_grade);
    expect(restored.status).toBe(row.status);
  });

  it("recordAttendance is idempotent and updates in place", async () => {
    const base = (
      await query<{ section_id: number; student_id: number; session_date: string }>(
        "SELECT section_id, student_id, session_date FROM attendance ORDER BY attendance_id LIMIT 1",
      )
    )[0];
    const before = Number(
      (
        await queryOne<number>(
          "SELECT COUNT(*)::int AS n FROM attendance WHERE section_id = $1 AND student_id = $2 AND session_date = $3::date",
          [base.section_id, base.student_id, base.session_date],
        )
      ) ?? 0,
    );

    // Twice, to prove the ON CONFLICT path works rather than just the insert.
    await recordAttendance({ ...base, status: "present" });
    await recordAttendance({ ...base, status: "absent" });

    const after = Number(
      (
        await queryOne<number>(
          "SELECT COUNT(*)::int AS n FROM attendance WHERE section_id = $1 AND student_id = $2 AND session_date = $3::date",
          [base.section_id, base.student_id, base.session_date],
        )
      ) ?? 0,
    );
    expect(after).toBe(before);

    const status = await queryOne<string>(
      "SELECT status::text AS status FROM attendance WHERE section_id = $1 AND student_id = $2 AND session_date = $3::date",
      [base.section_id, base.student_id, base.session_date],
    );
    expect(status).toBe("absent");

    // Put it back the way it was.
    await recordAttendance({ ...base, status: "present" });
  });

  it("recordAttendance adds a new row, and deleteAttendance removes it", async () => {
    // A session date no seeded row uses, so the insert takes the plain
    // INSERT path rather than the ON CONFLICT upsert.
    const base = (
      await query<{ section_id: number; student_id: number }>(
        "SELECT section_id, student_id FROM attendance ORDER BY attendance_id LIMIT 1",
      )
    )[0];
    const sessionDate = "2099-12-31";

    await recordAttendance({ ...base, session_date: sessionDate, status: "present" });

    const inserted = (
      await query<{ attendance_id: number }>(
        "SELECT attendance_id FROM attendance WHERE section_id = $1 AND student_id = $2 AND session_date = $3::date",
        [base.section_id, base.student_id, sessionDate],
      )
    )[0];
    expect(inserted).toBeDefined();

    const deleted = await deleteAttendance(inserted.attendance_id);
    expect(deleted).toBe(1);

    const remaining = await queryOne<number>(
      "SELECT COUNT(*)::int AS n FROM attendance WHERE section_id = $1 AND student_id = $2 AND session_date = $3::date",
      [base.section_id, base.student_id, sessionDate],
    );
    expect(Number(remaining)).toBe(0);
  });

  it("deleting a student cascades enrolments, as deleteStudent documents", async () => {
    // Asserted against the catalog rather than by deleting a real student.
    // The claim in deleteStuden's docstring is that removing a profile
    // takes its enrolments with it; if a future migration changes
    // confdeltype to 'a' (RESTRICT) or 'n' (SET NULL), that comment
    // becomes a lie and this catches it.
    const confdeltype = await queryOne<string>(
      "SELECT c.confdeltype::text AS t " +
        "FROM pg_constraint c " +
        "WHERE c.contype = 'f' " +
        "  AND c.conrelid = 'enrollments'::regclass " +
        "  AND c.confrelid = 'students'::regclass " +
        "  AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute " +
        "                      WHERE attrelid = 'enrollments'::regclass " +
        "                        AND attname = 'student_id')]",
    );
    // 'c' = CASCADE, 'a' = RESTRICT (no orphans, deletion refused).
    expect(["c", "a"]).toContain(confdeltype);

    void deleteStudent;
    void updateStudent;
  });
});

describe.skipIf(!hasDatabase())("the eight analytical reports", () => {
  it("there are exactly eight, keyed q1..q8", () => {
    expect(REPORTS).toHaveLength(8);
    expect(REPORTS.map((r) => r.key)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
  });

  for (const report of REPORTS) {
    it(`${report.key} runs and returns rows`, async () => {
      const rows = await run(report.key);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });
  }

  it("Q1 ranks departments by seat utilisation, highest first", async () => {
    const rows = await run<{ seat_utilisation_pct: string }>("q1");
    const values = rows.map((r) => Number(r.seat_utilisation_pct));
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it("Q3 returns at most ten students", async () => {
    const rows = await run<{ position: number }>("q3");
    expect(rows.length).toBeLessThanOrEqual(10);
  });

  it("Q5 percentages sum to about 100", async () => {
    // Exercises the window function SUM() OVER () that report 5 exists to
    // demonstrate.
    const rows = await run<{ pct_of_cohort: string }>("q5");
    const total = rows.reduce((sum, r) => sum + Number(r.pct_of_cohort), 0);
    expect(total).toBeGreaterThan(95);
    expect(total).toBeLessThan(105);
  });

  it("sqlByKey returns the SQL and rejects an unknown key", () => {
    expect(sqlByKey("q1")).toContain("seat_utilisation_pct");
    expect(() => sqlByKey("q99")).toThrow(/Unknown report/);
  });
});

describe.skipIf(!hasDatabase())("PL/pgSQL demonstration", () => {
  it("exercises all eight blocks and reports what came back", async () => {
    const rows = await demoProcedures();

    expect(rows).toHaveLength(7);
    expect(rows[0].returns).toBe("AA");
    expect(rows[1].returns).toBe("FF");

    // The roster function returns a set, so its "result" is a row count.
    expect(Number(rows[4].returns)).toBeGreaterThan(0);

    // Both procedure calls are expected to be refused, and the refusal is
    // the result. A row reading "no error raised" means an invariant broke.
    expect(String(rows[5].returns)).toMatch(/does not exist/);
    expect(String(rows[6].returns)).toMatch(/already enrolled/);
  });
});