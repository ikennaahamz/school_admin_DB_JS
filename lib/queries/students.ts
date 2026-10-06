/**
 * Students.
 *
 * Each function is a thin, honest wrapper around one SQL statement. The
 * deliberate constraint is that these contain no business rules: capacity,
 * credit limits, grade derivation and audit all live in PL/pgSQL in the
 * database, where they apply no matter which client writes the row. The UI
 * checks that a form was filled in; the database decides what is legal.
 */

import { exec, query } from "@/lib/db";

import { Conditions } from "./conditions";

export type StudentRow = {
  student_id: number;
  student_no: string;
  student_name: string;
  email: string;
  dept_code: string;
  dept_name: string;
  program_level: string;
  enrollment_year: number;
  gpa: string;
  advisor: string;
  /** COUNT() over a LEFT JOIN, so zero is a real 0 and not a missing row. */
  courses_taken: string;
};

export type NewStudent = {
  user_id: number;
  department_id: number;
  student_no: string;
  program_level: string;
  enrollment_year: number;
  advisor_id?: number | null;
};

export type StudentChanges = {
  department_id: number;
  program_level: string;
  enrollment_year: number;
  advisor_id?: number | null;
};

export async function listStudents(departmentId?: number | null, search = ""): Promise<StudentRow[]> {
  const where = new Conditions();

  if (departmentId) where.add("s.department_id = %s", [departmentId]);
  if (search) {
    where.add(
      "(u.first_name ILIKE %s OR u.last_name ILIKE %s " + "OR s.student_no ILIKE %s)",
      Array(3).fill(`%${search}%`),
    );
  }

  return query<StudentRow>(
    `
        SELECT s.student_id, s.student_no,
               u.first_name || ' ' || u.last_name AS student_name,
               u.email, d.dept_code, d.dept_name,
               s.program_level, s.enrollment_year,
               s.gpa,
               COALESCE(a.first_name || ' ' || a.last_name,
                        '(unassigned)') AS advisor,
               COUNT(e.enrollment_id) FILTER (WHERE e.status <> 'dropped')
                   AS courses_taken
          FROM students s
          JOIN users u        ON u.user_id = s.user_id
          JOIN departments d  ON d.department_id = s.department_id
          LEFT JOIN students adv ON adv.student_id = s.advisor_id
          LEFT JOIN users a    ON a.user_id = adv.user_id
          LEFT JOIN enrollments e ON e.student_id = s.student_id
         WHERE ${where.clause}
         GROUP BY s.student_id, s.student_no, u.first_name, u.last_name,
                  u.email, d.dept_code, d.dept_name, s.program_level,
                  s.enrollment_year, s.gpa, a.first_name, a.last_name
         ORDER BY s.student_no
        `,
    where.params,
  );
}

/** Create a student profile attached to an existing user account. */
export async function insertStudent(student: NewStudent): Promise<number> {
  const row = (await exec(
    `
        INSERT INTO students (user_id, department_id, student_no,
                              program_level, enrollment_year, advisor_id)
        VALUES ($1, $2, $3, $4::program_level, $5, $6)
        RETURNING student_id
        `,
    [
      student.user_id,
      student.department_id,
      student.student_no,
      student.program_level,
      student.enrollment_year,
      student.advisor_id ?? null,
    ],
    undefined,
    "student_id",
  )) as { student_id: number };

  return row.student_id;
}

export async function updateStudent(studentId: number, changes: StudentChanges): Promise<void> {
  await exec(
    `
        UPDATE students
           SET department_id = $1,
               program_level = $2::program_level,
               enrollment_year = $3,
               advisor_id = $4
         WHERE student_id = $5
        `,
    [changes.department_id, changes.program_level, changes.enrollment_year, changes.advisor_id ?? null, studentId],
  );
}

/**
 * Remove a student profile.
 *
 * The FK on students.user_id is ON DELETE CASCADE and the FK on
 * enrollments.student_id is too, so deleting a profile cascades to the
 * enrolment, submission and attendance rows that depend on it. The user
 * account itself survives, so the login is not orphaned.
 */
export async function deleteStudent(studentId: number): Promise<number> {
  return (await exec("DELETE FROM students WHERE student_id = $1", [studentId])) as number;
}