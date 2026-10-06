import { DataTable } from "@/components/DataTable";
import { EntityPicker, optionsFrom } from "@/components/EntityPicker";
import { Field, SubmitButton, Tabs } from "@/components/Form";
import { Flash } from "@/components/Flash";
import { enrolAction, setGradeAction, unenrolAction } from "@/lib/actions/crud";
import { readFlash } from "@/lib/flash";
import { requireScreen } from "@/lib/guard";
import { listEnrollments } from "@/lib/queries/enrollments";
import { listSections } from "@/lib/queries/sections";
import { listStudents } from "@/lib/queries/students";

/**
 * Enrolments.
 *
 * Three of the four tabs here are thin wrappers around database
 * behaviour rather than application logic:
 *
 *   Enrol     -> CALL enroll_student, so capacity and duplicate checks apply
 *   Grade     -> UPDATE final_grade, and the trigger derives the letter,
 *                sets the status, writes grade_audit and recomputes GPA
 *   Withdraw  -> status = 'dropped', keeping the row
 *
 * The screens deliberately do none of that themselves.
 */

const TABS = [
  { key: "view", label: "View" },
  { key: "enrol", label: "Enrol" },
  { key: "grade", label: "Grade" },
  { key: "drop", label: "Withdraw" },
];

const STATUSES = ["enrolled", "completed", "failed", "dropped"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** The composite label the Python screen built with `frame.assign(label=...)`. */
function enrolmentLabel(row: { student_name: string; course_code: string }): string {
  return `${row.student_name} — ${row.course_code}`;
}

export default async function EnrollmentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireScreen("enrollments");

  const params = await searchParams;
  const tab = TABS.some((t) => t.key === first(params.tab)) ? first(params.tab) : "view";
  const flash = readFlash(params);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">Enrolments</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          Enrolment goes through the <code>enroll_student</code> procedure, so the capacity rule
          and duplicate check apply. Grades are recorded through the audit trigger, which derives
          the letter and updates the student&apos;s GPA.
        </p>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      <Tabs active={tab} tabs={TABS} />

      {tab === "view" ? <ViewTab params={params} /> : null}
      {tab === "enrol" ? <EnrolTab /> : null}
      {tab === "grade" ? <GradeTab /> : null}
      {tab === "drop" ? <DropTab /> : null}
    </div>
  );
}

async function ViewTab({ params }: { params: Record<string, string | string[] | undefined> }) {
  const status = first(params.status);
  const rows = await listEnrollments(status === "" ? null : status);

  return (
    <div className="space-y-3">
      <form className="flex items-end gap-3" method="get">
        <input name="tab" type="hidden" value="view" />
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700" htmlFor="status">
            Status
          </label>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            defaultValue={status}
            id="status"
            name="status"
          >
            <option value="">(all)</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton variant="plain">Apply</SubmitButton>
      </form>

      <DataTable
        caption="Enrolments"
        columns={[
          { key: "student_no", header: "Student no" },
          { key: "student_name", header: "Student" },
          { key: "course_code", header: "Course" },
          { key: "term", header: "Term" },
          { key: "academic_year", header: "Year", numeric: true },
          { key: "status", header: "Status" },
          // NUMERIC and an ENUM, both returned as strings by pg.
          { key: "final_grade", header: "Grade", numeric: true },
          { key: "grade_letter", header: "Letter" },
          { key: "enrolled_at", header: "Enrolled" },
        ]}
        rows={rows as unknown as Record<string, unknown>[]}
      />
    </div>
  );
}

async function EnrolTab() {
  const [students, sections] = await Promise.all([listStudents(), listSections()]);

  return (
    <form action={enrolAction} className="max-w-xl space-y-4">
      <EntityPicker
        label="Student"
        name="student_id"
        options={optionsFrom(students as unknown as Record<string, unknown>[], "student_id", "student_name")}
        required
      />
      <EntityPicker
        label="Section"
        name="section_id"
        options={optionsFrom(sections as unknown as Record<string, unknown>[], "section_id", "course_name")}
        required
      />

      {/* If the procedure refuses, its own RAISE EXCEPTION text is what the
          user reads -- that is the value of routing enrolment through it. */}
      <SubmitButton>Enrol student</SubmitButton>
    </form>
  );
}

async function GradeTab() {
  // Only completed enrolments are gradable, as in the Python screen.
  const rows = await listEnrollments("completed");

  return (
    <div className="max-w-xl space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No completed enrolments to grade.</p>
      ) : (
        rows.map((row) => (
          <form
            action={setGradeAction}
            className="space-y-3 rounded-md border border-slate-200 p-4"
            key={row.enrollment_id}
          >
            <input name="enrollment_id" type="hidden" value={row.enrollment_id} />
            <input name="course_label" type="hidden" value={row.course_code} />

            <p className="text-sm text-slate-700">
              <strong>{enrolmentLabel(row)}</strong>
              <br />
              Current grade: <strong>{row.final_grade ?? "—"}</strong> ({row.grade_letter ?? "—"})
            </p>

            <Field
              defaultValue={Number(row.final_grade ?? 0)}
              hint="The trigger derives the letter, sets the status, writes the audit row and recomputes the student's GPA."
              label="New final grade (%)"
              max={100}
              min={0}
              name="grade"
              required
              step={0.5}
              type="number"
            />

            <SubmitButton>Record grade</SubmitButton>
          </form>
        ))
      )}
    </div>
  );
}

async function DropTab() {
  const rows = await listEnrollments("enrolled");

  return (
    <div className="max-w-2xl space-y-4">
      <Flash
        kind="info"
        message="Withdrawing sets the status to 'dropped' and keeps the row, so the history of who took and dropped what survives."
      />

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing is currently enrolled.</p>
      ) : (
        <div className="overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Student</th>
                <th className="px-3 py-2 font-medium">Course</th>
                <th className="px-3 py-2 font-medium">Enrolled</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-slate-100" key={row.enrollment_id}>
                  <td className="px-3 py-2 text-slate-900">{row.student_name}</td>
                  <td className="px-3 py-2 text-slate-700">{row.course_code}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {row.enrolled_at ? new Date(row.enrolled_at).toISOString().slice(0, 10) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <form action={unenrolAction}>
                      <input name="enrollment_id" type="hidden" value={row.enrollment_id} />
                      <SubmitButton variant="danger">Withdraw</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
