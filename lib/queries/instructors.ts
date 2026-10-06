/**
 * Instructors.
 *
 * No business rules here either -- see lib/queries/students.ts for why.
 */

import { exec, query } from "@/lib/db";

export type InstructorRow = {
  instructor_id: number;
  employee_no: string;
  instructor_name: string;
  email: string;
  status: string;
  dept_name: string;
  rank_title: string;
  /** DATE, returned as a plain YYYY-MM-DD string by the type parser in lib/db.ts. */
  hire_date: string;
  /** NUMERIC, returned as a string. */
  salary: string;
  sections_taught: string;
};

export type NewInstructor = {
  user_id: number;
  department_id: number;
  employee_no: string;
  hire_date: string;
  rank_title: string;
  salary?: number | null;
};

export type InstructorChanges = {
  department_id: number;
  rank_title: string;
  salary?: number | null;
};

export async function listInstructors(): Promise<InstructorRow[]> {
  return query<InstructorRow>(
    `
        SELECT i.instructor_id, i.employee_no,
               u.first_name || ' ' || u.last_name AS instructor_name,
               u.email, u.status, d.dept_name,
               i.rank_title, i.hire_date, i.salary,
               COUNT(cs.section_id) AS sections_taught
          FROM instructors i
          JOIN users u       ON u.user_id = i.user_id
          JOIN departments d ON d.department_id = i.department_id
          LEFT JOIN course_sections cs ON cs.instructor_id = i.instructor_id
         GROUP BY i.instructor_id, i.employee_no, u.first_name, u.last_name,
                  u.email, u.status, d.dept_name, i.rank_title,
                  i.hire_date, i.salary
         ORDER BY i.employee_no
        `,
  );
}

export async function insertInstructor(instructor: NewInstructor): Promise<number> {
  const row = (await exec(
    `
        INSERT INTO instructors (user_id, department_id, employee_no,
                                 hire_date, rank_title, salary)
        VALUES ($1, $2, $3, $4::date, $5, $6)
        RETURNING instructor_id
        `,
    [
      instructor.user_id,
      instructor.department_id,
      instructor.employee_no,
      instructor.hire_date,
      instructor.rank_title,
      instructor.salary ?? null,
    ],
    undefined,
    "instructor_id",
  )) as { instructor_id: number };

  return row.instructor_id;
}

export async function updateInstructor(instructorId: number, changes: InstructorChanges): Promise<void> {
  await exec(
    `
        UPDATE instructors
           SET department_id = $1, rank_title = $2, salary = $3
         WHERE instructor_id = $4
        `,
    [changes.department_id, changes.rank_title, changes.salary ?? null, instructorId],
  );
}

/**
 * Delete a profile.
 *
 * course_sections.instructor_id is ON DELETE SET NULL, so the course
 * sections survive and simply become unassigned. A hard delete of the
 * sections would orphan real teaching records.
 */
export async function deleteInstructor(instructorId: number): Promise<number> {
  return (await exec("DELETE FROM instructors WHERE instructor_id = $1", [instructorId])) as number;
}