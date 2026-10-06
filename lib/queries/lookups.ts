/**
 * Lookups and lists that the screens needed but that were not in
 * `src/crud`.
 *
 * In the Python app these were inline `db.query_df(...)` calls inside
 * `screens.py`, because a screen was allowed to know about SQL. They are
 * collected here instead so that every statement in the application lives
 * in one of two places -- `lib/db.ts` for connection handling, or a query
 * module -- and a reader looking for a query finds it without opening a
 * page component.
 *
 * Nothing here contains a rule. Filters and joins only.
 */

import { query } from "@/lib/db";

export type Department = { department_id: number; dept_code: string; dept_name: string };

/** `screens.py::_departments()` */
export async function listDepartments(): Promise<Department[]> {
  return query<Department>(
    "SELECT department_id, dept_code, dept_name FROM departments ORDER BY dept_code",
  );
}

export type Classroom = { classroom_id: number; room: string };

/** Used by the course-sections screen's classroom picker. */
export async function listClassrooms(): Promise<Classroom[]> {
  return query<Classroom>(
    `SELECT classroom_id, building || ' ' || room_number AS room
       FROM classrooms ORDER BY building, room_number`,
  );
}

export type SubmissionRow = {
  submission_id: number;
  course_code: string;
  title: string;
  student_no: string;
  student_name: string;
  submitted_at: Date | null;
  score: string | null;
  is_late: boolean;
  pct: string | null;
};

/** The submissions listing, capped as the Python one was. */
export async function listSubmissions(): Promise<SubmissionRow[]> {
  return query<SubmissionRow>(`
        SELECT sm.submission_id, cs.course_code, a.title,
               s.student_no,
               u.first_name || ' ' || u.last_name AS student_name,
               sm.submitted_at, sm.score, sm.is_late,
               ROUND(100.0 * sm.score / a.max_points, 1) AS pct
          FROM submissions sm
          JOIN assignments a     ON a.assignment_id = sm.assignment_id
          JOIN course_sections cs ON cs.section_id = a.section_id
          JOIN students s        ON s.student_id = sm.student_id
          JOIN users u           ON u.user_id = s.user_id
         ORDER BY cs.course_code, a.title, s.student_no
         LIMIT 300
        `);
}

export type UnmarkedSubmission = {
  submission_id: number;
  course_code: string;
  title: string;
  student_no: string;
  student_name: string;
  score: string | null;
  max_points: string;
};

/** Submissions still awaiting a mark, for the grading form. */
export async function listUnmarkedSubmissions(): Promise<UnmarkedSubmission[]> {
  return query<UnmarkedSubmission>(`
        SELECT sm.submission_id, cs.course_code, a.title,
               s.student_no,
               u.first_name || ' ' || u.last_name AS student_name,
               sm.score, a.max_points
          FROM submissions sm
          JOIN assignments a     ON a.assignment_id = sm.assignment_id
          JOIN course_sections cs ON cs.section_id = a.section_id
          JOIN students s        ON s.student_id = sm.student_id
          JOIN users u           ON u.user_id = s.user_id
         WHERE sm.score IS NULL
         ORDER BY cs.course_code, s.student_no
         LIMIT 200
        `);
}

export type GradeAuditRow = {
  audit_id: number;
  changed_at: Date;
  changed_by: string;
  student_no: string;
  student_name: string | null;
  course_code: string;
  old_grade: string | null;
  new_grade: string | null;
  old_letter: string | null;
  new_letter: string | null;
};

/**
 * The grade audit trail.
 *
 * `student_name` is joined through `users`, so `includeNames = false`
 * returns nulls for it -- the Python used two different queries for the
 * reports screen and the admin screen, differing only in that join and the
 * limit. One parameter beats two near-identical copies that can drift.
 */
export async function listGradeAudit(limit: number, includeNames: boolean): Promise<GradeAuditRow[]> {
  return query<GradeAuditRow>(
    `
        SELECT ga.audit_id, ga.changed_at, ga.changed_by,
               s.student_no,
               ${includeNames ? "u.first_name || ' ' || u.last_name" : "NULL::text"} AS student_name,
               cs.course_code, ga.old_grade, ga.new_grade,
               ga.old_letter, ga.new_letter
          FROM grade_audit ga
          JOIN students s         ON s.student_id = ga.student_id
          ${includeNames ? "JOIN users u ON u.user_id = s.user_id" : ""}
          JOIN course_sections cs ON cs.section_id = ga.section_id
         ORDER BY ga.audit_id DESC LIMIT $1
        `,
    [limit],
  );
}

/** The dashboard's recent-changes panel, which has no student id join. */
export async function listRecentGradeChanges(limit = 10) {
  return query<{
    changed_at: Date;
    changed_by: string;
    student_no: string;
    student_name: string;
    course_code: string;
    old_grade: string | null;
    new_grade: string | null;
    new_letter: string | null;
  }>(
    `
        SELECT ga.changed_at, ga.changed_by,
               s.student_no,
               u.first_name || ' ' || u.last_name AS student_name,
               cs.course_code,
               ga.old_grade, ga.new_grade, ga.new_letter
          FROM grade_audit ga
          JOIN enrollments e     ON e.enrollment_id = ga.enrollment_id
          JOIN students s        ON s.student_id = ga.student_id
          JOIN users u           ON u.user_id = s.user_id
          JOIN course_sections cs ON cs.section_id = ga.section_id
         ORDER BY ga.audit_id DESC LIMIT $1
        `,
    [limit],
  );
}
