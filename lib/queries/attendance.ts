/**
 * Attendance.
 */

import { exec, query } from "@/lib/db";

import { Conditions } from "./conditions";

export type AttendanceRow = {
  attendance_id: number;
  course_code: string;
  student_no: string;
  student_name: string;
  session_date: string;
  status: string;
};

export type AttendanceMark = {
  section_id: number;
  student_id: number;
  session_date: string;
  status: string;
};

export async function listAttendance(sectionId?: number | null, studentId?: number | null): Promise<AttendanceRow[]> {
  const where = new Conditions();

  if (sectionId) where.add("a.section_id = %s", [sectionId]);
  if (studentId) where.add("a.student_id = %s", [studentId]);

  return query<AttendanceRow>(
    `
        SELECT a.attendance_id, cs.course_code,
               s.student_no,
               su.first_name || ' ' || su.last_name AS student_name,
               a.session_date, a.status
          FROM attendance a
          JOIN course_sections cs ON cs.section_id = a.section_id
          JOIN students s   ON s.student_id = a.student_id
          JOIN users su     ON su.user_id = s.user_id
         WHERE ${where.clause}
         ORDER BY cs.course_code, a.session_date, s.student_no
        `,
    where.params,
  );
}

/**
 * Upsert one attendance mark.
 *
 * ON CONFLICT against (section_id, student_id, session_date) makes the
 * form idempotent: marking the same session twice corrects the earlier
 * value instead of failing on the unique constraint.
 */
export async function recordAttendance(mark: AttendanceMark): Promise<void> {
  await exec(
    `
        INSERT INTO attendance (section_id, student_id, session_date, status)
        VALUES ($1, $2, $3::date, $4::attendance_status)
        ON CONFLICT (section_id, student_id, session_date)
        DO UPDATE SET status = EXCLUDED.status
        `,
    [mark.section_id, mark.student_id, mark.session_date, mark.status],
  );
}

export async function deleteAttendance(attendanceId: number): Promise<number> {
  return (await exec("DELETE FROM attendance WHERE attendance_id = $1", [attendanceId])) as number;
}