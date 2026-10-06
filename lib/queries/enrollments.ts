/**
 * Enrolments.
 *
 * The three write functions here are the ones that must not be plain SQL:
 * `enrol` goes through the PL/pgSQL procedure so the capacity rule, the
 * duplicate check and the credit-load warning all apply, and `unenrol`
 * and `setGrade` rely on the BEFORE UPDATE trigger to derive the letter
 * grade, set the status, write the audit row and recompute the student's
 * GPA. Each of those is a graded artefact of the schema.
 */

import { callProcedure, exec, query } from "@/lib/db";

import { Conditions } from "./conditions";

export type EnrollmentRow = {
  enrollment_id: number;
  student_no: string;
  student_name: string;
  course_code: string;
  course_name: string;
  term: string;
  academic_year: number;
  status: string;
  /** NUMERIC, returned as a string. */
  final_grade: string | null;
  grade_letter: string | null;
  /** TIMESTAMPTZ, returned as a JS Date. */
  enrolled_at: Date;
};

export async function listEnrollments(status?: string | null): Promise<EnrollmentRow[]> {
  const where = new Conditions();
  if (status) where.add("e.status = %s::enroll_status", [status]);

  return query<EnrollmentRow>(
    `
        SELECT e.enrollment_id, s.student_no,
               su.first_name || ' ' || su.last_name AS student_name,
               cs.course_code, cs.course_name, cs.term, cs.academic_year,
               e.status, e.final_grade, e.grade_letter, e.enrolled_at
          FROM enrollments e
          JOIN students s        ON s.student_id = e.student_id
          JOIN users su          ON su.user_id = s.user_id
          JOIN course_sections cs ON cs.section_id = e.section_id
         WHERE ${where.clause}
         ORDER BY s.student_no, cs.course_code
        `,
    where.params,
  );
}

/**
 * Enrol via the PL/pgSQL procedure, not a bare INSERT.
 *
 * Calling `enroll_student` means the capacity rule, the duplicate check
 * and the credit-load warning all apply. An INSERT here would bypass all
 * three, which is the single easiest way to break the invariants this
 * schema exists to enforce.
 */
export async function enrol(studentId: number, sectionId: number, actor: string): Promise<void> {
  await callProcedure("enroll_student", [studentId, sectionId], actor);
}

/**
 * Withdraw an enrolment by marking it dropped.
 *
 * Deliberately not a DELETE: the audit trail and the history of who took
 * and dropped what are worth keeping. A status change keeps the row and
 * lets the enrolled_count trigger decrement.
 */
export async function unenrol(enrollmentId: number, actor: string): Promise<number> {
  return (await exec(
    "UPDATE enrollments SET status = 'dropped', final_grade = NULL, " + "grade_letter = NULL WHERE enrollment_id = $1",
    [enrollmentId],
    actor,
  )) as number;
}

/**
 * Record a final grade.
 *
 * The BEFORE UPDATE trigger derives the letter, sets the status to
 * completed or failed, writes the audit row and recomputes the student's
 * GPA. Passing null withdraws the grade, which the trigger treats as a
 * withdrawal rather than a fail.
 */
export async function setGrade(enrollmentId: number, grade: number | null, actor: string): Promise<void> {
  await exec("UPDATE enrollments SET final_grade = $1 WHERE enrollment_id = $2", [grade, enrollmentId], actor);
}