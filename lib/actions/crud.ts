/**
 * Server actions for the CRUD screens.
 *
 * These replace the `if submitted:` blocks in `src/screens.py`.
 *
 * Two things are worth stating because they are deliberate choices rather
 * than transliterations:
 *
 * 1. **The actor is read from the session, never from the form.** The
 *    Python code passed `user.username` down from the authenticated
 *    `User`, so a request could not forge it either -- but in a Server
 *    Action the temptation is to accept an `actor` field, and that would
 *    let anyone attribute a grade change to somebody else. There is no
 *    such field.
 *
 * 2. **Each action redirects to its own screen, hard-coded.** A form
 *    carries no `returnTo` hidden input, because a caller-controlled
 *    redirect target is an open redirect. Where to go after a write is a
 *    property of the action, not of the request.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { DatabaseError, queryOne } from "@/lib/db";
import { withFlash } from "@/lib/flash";
import * as assignments from "@/lib/queries/assignments";
import * as attendance from "@/lib/queries/attendance";
import * as enrollments from "@/lib/queries/enrollments";
import * as instructors from "@/lib/queries/instructors";
import * as sections from "@/lib/queries/sections";
import * as students from "@/lib/queries/students";
import * as users from "@/lib/queries/users";
import { currentUser } from "@/lib/session";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** An empty select means "(none)" -- the sentinel `EntityPicker` renders. */
function optionalId(formData: FormData, name: string): number | null {
  const raw = field(formData, name);
  return raw === "" ? null : Number(raw);
}

function requiredId(formData: FormData, name: string): number {
  const raw = field(formData, name);
  if (raw === "") throw new ValidationError(`Missing ${name}.`);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ValidationError(`Invalid ${name}.`);
  return n;
}

function numberField(formData: FormData, name: string): number {
  const raw = field(formData, name);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ValidationError(`${name} must be a number.`);
  return n;
}

/**
 * A form problem, as opposed to a database refusal.
 *
 * Distinguished because the Python screens showed the two differently: a
 * missing field was a plain red message, while a constraint violation
 * carried the SQLSTATE an instructor wants to see. Merging them would lose
 * that distinction, so it is preserved.
 */
class ValidationError extends Error {}

/** Finish an action: refresh the screen's data, then go back to it with a message. */
async function done(path: string, tab: string, kind: "success" | "error", message: string): Promise<never> {
  revalidatePath(path);
  const separator = path.includes("?") ? "&" : "?";
  redirect(withFlash(`${path}${separator}tab=${tab}`, kind, message));
}

/** Run a write, translating either failure mode into a flash. */
async function attempt(
  path: string,
  tab: string,
  work: () => Promise<string | { error: string }>,
): Promise<never> {
  try {
    const outcome = await work();
    if (typeof outcome === "string") return done(path, tab, "success", outcome);
    return done(path, tab, "error", outcome.error);
  } catch (err) {
    if (err instanceof ValidationError) return done(path, tab, "error", err.message);
    if (err instanceof DatabaseError) return done(path, tab, "error", err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

const STUDENTS = "/students";

export async function insertStudentAction(formData: FormData): Promise<never> {
  return attempt(STUDENTS, "insert", async () => {
    const username = field(formData, "username");
    const studentNo = field(formData, "student_no");

    if (username === "") return { error: "Enter the username of the linked account." };
    if (studentNo === "") return { error: "Enter a student number." };

    const userId = await queryOne<number>("SELECT user_id FROM users WHERE username = $1", [
      username.toLowerCase(),
    ]);
    if (userId === null) {
      return {
        error: `No user account named '${username}'. Create the account in User Admin first.`,
      };
    }

    const newId = await students.insertStudent({
      user_id: Number(userId),
      department_id: requiredId(formData, "department_id"),
      student_no: studentNo,
      program_level: field(formData, "program_level"),
      enrollment_year: numberField(formData, "enrollment_year"),
      advisor_id: optionalId(formData, "advisor_id"),
    });

    return `Inserted: student ${studentNo} (student_id ${newId})`;
  });
}

export async function updateStudentAction(formData: FormData): Promise<never> {
  return attempt(STUDENTS, "update", async () => {
    const studentNo = field(formData, "student_no_label");
    await students.updateStudent(requiredId(formData, "student_id"), {
      department_id: requiredId(formData, "department_id"),
      program_level: field(formData, "program_level"),
      enrollment_year: numberField(formData, "enrollment_year"),
      advisor_id: optionalId(formData, "advisor_id"),
    });
    return `Updated: student ${studentNo}`;
  });
}

export async function deleteStudentAction(formData: FormData): Promise<never> {
  return attempt(STUDENTS, "delete", async () => {
    const studentNo = field(formData, "student_no_label");
    await students.deleteStudent(requiredId(formData, "student_id"));
    return `Deleted: ${studentNo}`;
  });
}

// ---------------------------------------------------------------------------
// Instructors
// ---------------------------------------------------------------------------

const INSTRUCTORS = "/instructors";

export async function insertInstructorAction(formData: FormData): Promise<never> {
  return attempt(INSTRUCTORS, "insert", async () => {
    const username = field(formData, "username");
    const userId = await queryOne<number>("SELECT user_id FROM users WHERE username = $1", [
      username.toLowerCase(),
    ]);
    if (userId === null) return { error: `No user account named '${username}'.` };

    const newId = await instructors.insertInstructor({
      user_id: Number(userId),
      department_id: requiredId(formData, "department_id"),
      employee_no: field(formData, "employee_no"),
      hire_date: field(formData, "hire_date"),
      rank_title: field(formData, "rank_title"),
      salary: field(formData, "salary") === "" ? null : numberField(formData, "salary"),
    });
    return `Inserted: instructor_id ${newId}`;
  });
}

export async function updateInstructorAction(formData: FormData): Promise<never> {
  return attempt(INSTRUCTORS, "update", async () => {
    const name = field(formData, "name_label");
    await instructors.updateInstructor(requiredId(formData, "instructor_id"), {
      department_id: requiredId(formData, "department_id"),
      rank_title: field(formData, "rank_title"),
      salary: field(formData, "salary") === "" ? null : numberField(formData, "salary"),
    });
    return `Updated: ${name}`;
  });
}

export async function deleteInstructorAction(formData: FormData): Promise<never> {
  return attempt(INSTRUCTORS, "delete", async () => {
    const name = field(formData, "name_label");
    await instructors.deleteInstructor(requiredId(formData, "instructor_id"));
    return `Deleted: ${name}`;
  });
}

// ---------------------------------------------------------------------------
// Course sections
// ---------------------------------------------------------------------------

const SECTIONS = "/sections";

export async function insertSectionAction(formData: FormData): Promise<never> {
  return attempt(SECTIONS, "insert", async () => {
    const code = field(formData, "course_code");
    const name = field(formData, "course_name");
    if (code === "" || name === "") return { error: "Course code and name are both required." };

    const newId = await sections.insertSection({
      course_code: code,
      course_name: name,
      term: field(formData, "term"),
      academic_year: numberField(formData, "academic_year"),
      instructor_id: optionalId(formData, "instructor_id"),
      classroom_id: optionalId(formData, "classroom_id"),
      credits: numberField(formData, "credits"),
      capacity: numberField(formData, "capacity"),
    });
    return `Inserted: section_id ${newId}`;
  });
}

export async function updateSectionAction(formData: FormData): Promise<never> {
  return attempt(SECTIONS, "update", async () => {
    const code = field(formData, "code_label");
    await sections.updateSection(requiredId(formData, "section_id"), {
      instructor_id: optionalId(formData, "instructor_id"),
      classroom_id: optionalId(formData, "classroom_id"),
      capacity: numberField(formData, "capacity"),
    });
    return `Updated: ${code}`;
  });
}

export async function deleteSectionAction(formData: FormData): Promise<never> {
  return attempt(SECTIONS, "delete", async () => {
    const code = field(formData, "code_label");
    await sections.deleteSection(requiredId(formData, "section_id"));
    return `Deleted: ${code}`;
  });
}

// ---------------------------------------------------------------------------
// Enrolments
// ---------------------------------------------------------------------------

const ENROLLMENTS = "/enrollments";

export async function enrolAction(formData: FormData): Promise<never> {
  return attempt(ENROLLMENTS, "enrol", async () => {
    const user = await currentUser();
    const studentId = requiredId(formData, "student_id");
    const sectionId = requiredId(formData, "section_id");

    // The procedure's own RAISE EXCEPTION text arrives as a DatabaseError
    // and becomes the message the user reads. That is the point of routing
    // enrolment through it rather than issuing an INSERT.
    await enrollments.enrol(studentId, sectionId, user!.username);
    return `Enrolled: student ${studentId} into section ${sectionId}`;
  });
}

export async function setGradeAction(formData: FormData): Promise<never> {
  return attempt(ENROLLMENTS, "grade", async () => {
    const user = await currentUser();
    const courseCode = field(formData, "course_label");
    const grade = numberField(formData, "grade");

    await enrollments.setGrade(requiredId(formData, "enrollment_id"), grade, user!.username);

    return (
      `Recorded: grade ${grade} for ${courseCode}. The trigger derived the ` +
      "letter and updated the student's GPA."
    );
  });
}

export async function unenrolAction(formData: FormData): Promise<never> {
  return attempt(ENROLLMENTS, "drop", async () => {
    const user = await currentUser();
    const target = requiredId(formData, "enrollment_id");
    await enrollments.unenrol(target, user!.username);
    return `Withdrawn: enrolment ${target}`;
  });
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

const ASSIGNMENTS = "/assignments";

export async function insertAssignmentAction(formData: FormData): Promise<never> {
  return attempt(ASSIGNMENTS, "insert", async () => {
    const title = field(formData, "title");
    if (title === "") return { error: "Enter a title." };

    const newId = await assignments.insertAssignment({
      section_id: requiredId(formData, "section_id"),
      title,
      weight: numberField(formData, "weight"),
      max_points: numberField(formData, "max_points"),
      due_date: field(formData, "due_date"),
    });
    return `Inserted: assignment ${newId}`;
  });
}

export async function deleteAssignmentAction(formData: FormData): Promise<never> {
  return attempt(ASSIGNMENTS, "delete", async () => {
    const label = field(formData, "label");
    await assignments.deleteAssignment(requiredId(formData, "assignment_id"));
    return `Deleted: ${label}`;
  });
}

export async function gradeSubmissionAction(formData: FormData): Promise<never> {
  return attempt(ASSIGNMENTS, "grade", async () => {
    const user = await currentUser();
    const score = numberField(formData, "score");
    await assignments.gradeSubmission(
      requiredId(formData, "submission_id"),
      score,
      field(formData, "feedback"),
      user!.username,
    );
    return `Saved: score ${score}`;
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

const ATTENDANCE = "/attendance";

export async function recordAttendanceAction(formData: FormData): Promise<never> {
  return attempt(ATTENDANCE, "mark", async () => {
    const studentId = requiredId(formData, "student_id");
    const status = field(formData, "status");
    const sessionDate = field(formData, "session_date");

    await attendance.recordAttendance({
      section_id: requiredId(formData, "section_id"),
      student_id: studentId,
      session_date: sessionDate,
      status,
    });
    return `Saved: ${studentId} marked '${status}' on ${sessionDate}`;
  });
}

export async function deleteAttendanceAction(formData: FormData): Promise<never> {
  return attempt(ATTENDANCE, "delete", async () => {
    const label = field(formData, "label");
    await attendance.deleteAttendance(requiredId(formData, "attendance_id"));
    return `Deleted: ${label}`;
  });
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

const ADMIN = "/admin";

export async function setUserStatusAction(formData: FormData): Promise<never> {
  return attempt(ADMIN, "accounts", async () => {
    const user = await currentUser();
    const username = field(formData, "username_label");
    const status = field(formData, "status");

    await users.setUserStatus(requiredId(formData, "user_id"), status, user!.username);
    return `Updated: ${username} is now '${status}'`;
  });
}

export async function grantRoleAction(formData: FormData): Promise<never> {
  return attempt(ADMIN, "accounts", async () => {
    const user = await currentUser();
    const role = field(formData, "role");
    await users.grantRole(requiredId(formData, "user_id"), role, user!.username);
    return `Granted: ${role}`;
  });
}

export async function revokeRoleAction(formData: FormData): Promise<never> {
  return attempt(ADMIN, "accounts", async () => {
    const user = await currentUser();
    const role = field(formData, "role");
    await users.revokeRole(requiredId(formData, "user_id"), role, user!.username);
    return `Revoked: ${role}`;
  });
}

export async function createUserAction(formData: FormData): Promise<never> {
  return attempt(ADMIN, "create", async () => {
    const user = await currentUser();
    const username = field(formData, "username");
    const role = field(formData, "role");

    // Password rules are checked here as well as in `auth.passwordProblems`
    // so the form can refuse before hashing: bcrypt at cost 12 takes about
    // half a second, and there is no reason to spend it on a known-bad
    // password.
    const { passwordProblems } = await import("@/lib/auth");
    const problems = passwordProblems(field(formData, "password"), field(formData, "confirmation"));
    if (problems.length > 0) return { error: problems.join(" ") };

    const newId = await users.createUser(
      {
        username,
        email: field(formData, "email"),
        first_name: field(formData, "first_name"),
        last_name: field(formData, "last_name"),
        password: field(formData, "password"),
        role_name: role,
      },
      user!.username,
    );
    return `Created: ${username} (user_id ${newId}) with role ${role}`;
  });
}
