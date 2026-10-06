/**
 * Assignments and submissions.
 */

import { exec, query, queryOne } from "@/lib/db";

import { Conditions } from "./conditions";

export type AssignmentRow = {
  assignment_id: number;
  course_code: string;
  title: string;
  /** NUMERIC, returned as a string. */
  weight: string;
  max_points: string;
  due_date: string;
  submitted: string;
  enrolled: string;
  avg_score: string | null;
};

export type NewAssignment = {
  section_id: number;
  title: string;
  weight: number;
  max_points: number;
  due_date: string;
};

export async function listAssignments(sectionId?: number | null): Promise<AssignmentRow[]> {
  const where = new Conditions();
  if (sectionId) where.add("a.section_id = %s", [sectionId]);

  return query<AssignmentRow>(
    `
        SELECT a.assignment_id, cs.course_code, a.title, a.weight,
               a.max_points, a.due_date,
               COUNT(sm.submission_id) AS submitted,
               COUNT(e.student_id)     AS enrolled,
               ROUND(AVG(sm.score), 1) AS avg_score
          FROM assignments a
          JOIN course_sections cs ON cs.section_id = a.section_id
          LEFT JOIN enrollments e  ON e.section_id = a.section_id
                                 AND e.status <> 'dropped'
          LEFT JOIN submissions sm ON sm.assignment_id = a.assignment_id
                                 AND sm.student_id = e.student_id
         WHERE ${where.clause}
         GROUP BY a.assignment_id, cs.course_code, a.title, a.weight,
                  a.max_points, a.due_date
         ORDER BY cs.course_code, a.due_date
        `,
    where.params,
  );
}

export async function insertAssignment(assignment: NewAssignment): Promise<number> {
  const row = (await exec(
    `
        INSERT INTO assignments (section_id, title, weight, max_points,
                                 due_date)
        VALUES ($1, $2, $3, $4, $5::date)
        RETURNING assignment_id
        `,
    [assignment.section_id, assignment.title, assignment.weight, assignment.max_points, assignment.due_date],
    undefined,
    "assignment_id",
  )) as { assignment_id: number };

  return row.assignment_id;
}

export async function deleteAssignment(assignmentId: number): Promise<number> {
  return (await exec("DELETE FROM assignments WHERE assignment_id = $1", [assignmentId])) as number;
}

export async function gradeSubmission(
  submissionId: number,
  score: number | null,
  feedback: string,
  actor: string,
): Promise<void> {
  await exec(
    `
        UPDATE submissions
           SET score = $1, feedback = $2, graded_by = $3
         WHERE submission_id = $4
        `,
    [score, feedback, await graderId(actor), submissionId],
    actor,
  );
}

/**
 * Map an actor name back to a users.user_id for graded_by.
 *
 * The actor is carried as a name because that is what the session holds,
 * but `submissions.graded_by` is a foreign key. Unknown name resolves to
 * null, which the column allows, rather than throwing.
 */
async function graderId(username: string): Promise<number | null> {
  const id = await queryOne<number>("SELECT user_id FROM users WHERE username = $1", [username]);
  return id === null ? null : Number(id);
}