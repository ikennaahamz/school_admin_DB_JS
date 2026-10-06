import { DataTable } from "@/components/DataTable";
import { EntityPicker, optionsFrom } from "@/components/EntityPicker";
import { Field, SelectField, SubmitButton, Tabs } from "@/components/Form";
import { Flash } from "@/components/Flash";
import {
  deleteStudentAction,
  insertStudentAction,
  updateStudentAction,
} from "@/lib/actions/crud";
import { readFlash } from "@/lib/flash";
import { requireScreen } from "@/lib/guard";
import { listDepartments } from "@/lib/queries/lookups";
import { listStudents } from "@/lib/queries/students";

/**
 * Students.
 *
 * The four tabs (View / Insert / Update / Delete) are `st.tabs` ported as
 * links with a `?tab=` parameter, so a tab is a real URL rather than
 * client-side state.
 */

const TABS = [
  { key: "view", label: "View" },
  { key: "insert", label: "Insert" },
  { key: "update", label: "Update" },
  { key: "delete", label: "Delete" },
];

const LEVELS = ["undergraduate", "graduate", "phd"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function StudentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireScreen("students");

  const params = await searchParams;
  const tab = TABS.some((t) => t.key === first(params.tab)) ? first(params.tab) : "view";
  const flash = readFlash(params);

  const departments = await listDepartments();
  const deptOptions = optionsFrom(departments, "department_id", "dept_name");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Students</h1>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      <Tabs active={tab} tabs={TABS} />

      {tab === "view" ? (
        <ViewTab departments={deptOptions} params={params} />
      ) : null}
      {tab === "insert" ? <InsertTab departments={deptOptions} /> : null}
      {tab === "update" ? <UpdateTab departments={deptOptions} params={params} /> : null}
      {tab === "delete" ? <DeleteTab /> : null}
    </div>
  );
}

async function ViewTab({
  departments,
  params,
}: {
  departments: { value: string; label: string }[];
  params: Record<string, string | string[] | undefined>;
}) {
  const departmentId = first(params.department_id);
  const search = first(params.search);

  const rows = await listStudents(departmentId === "" ? null : Number(departmentId), search);

  return (
    <div className="space-y-3">
      {/* A GET form: the browser holds the filters and submits them, which
          is what Streamlit's rerun-on-change was doing implicitly. */}
      <form className="flex flex-wrap items-end gap-3" method="get">
        <input name="tab" type="hidden" value="view" />
        <div className="min-w-56 space-y-1">
          <label className="block text-sm font-medium text-slate-700" htmlFor="department_id">
            Department
          </label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            defaultValue={departmentId}
            id="department_id"
            name="department_id"
          >
            <option value="">(all)</option>
            {departments.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1 space-y-1">
          <label className="block text-sm font-medium text-slate-700" htmlFor="search">
            Search name or student number
          </label>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={search}
            id="search"
            name="search"
          />
        </div>
        <SubmitButton variant="plain">Apply</SubmitButton>
      </form>

      <p className="text-sm text-slate-500">{rows.length} students</p>

      <DataTable
        caption="Students"
        columns={[
          { key: "student_no", header: "Student no" },
          { key: "student_name", header: "Name" },
          { key: "email", header: "Email" },
          { key: "dept_name", header: "Department" },
          { key: "program_level", header: "Level" },
          { key: "enrollment_year", header: "Year", numeric: true },
          { key: "gpa", header: "GPA", numeric: true },
          { key: "advisor", header: "Advisor" },
          { key: "courses_taken", header: "Courses", numeric: true },
        ]}
        empty="No students match those filters."
        rows={rows as unknown as Record<string, unknown>[]}
      />
    </div>
  );
}

async function InsertTab({ departments }: { departments: { value: string; label: string }[] }) {
  // Every existing student is a candidate advisor, as in the Python
  // screen, which offered `_pick(crud.list_students(), ...)`.
  const students = await listStudents();

  return (
    <form action={insertStudentAction} className="max-w-2xl space-y-4">
      <p className="text-sm text-slate-600">
        A student profile attaches to an existing user account. Create the account in{" "}
        <strong>User Admin</strong> first.
      </p>

      <Field
        autoComplete="off"
        hint="The login this profile belongs to."
        label="Existing username"
        name="username"
        required
      />
      <Field defaultValue="S-" label="Student number" name="student_no" required />
      <EntityPicker label="Department" name="department_id" options={departments} required />
      <SelectField choices={LEVELS} label="Programme level" name="program_level" />
      <Field
        defaultValue={2025}
        label="Enrolment year"
        max={2100}
        min={2000}
        name="enrollment_year"
        required
        type="number"
      />
      <EntityPicker
        label="Advisor"
        name="advisor_id"
        options={optionsFrom(students as unknown as Record<string, unknown>[], "student_id", "student_name")}
      />

      <SubmitButton>Insert student</SubmitButton>
    </form>
  );
}

async function UpdateTab({
  departments,
  params,
}: {
  departments: { value: string; label: string }[];
  params: Record<string, string | string[] | undefined>;
}) {
  const students = await listStudents();
  const pick = first(params.pick);
  const current = students.find((s) => String(s.student_id) === pick);

  return (
    <div className="max-w-2xl space-y-4">
      {/* Step one: choose the row. A GET form, so the choice lands in the
          URL and the page re-renders server-side with that row's values as
          the form defaults -- which is what Streamlit did when the
          selectbox changed and the form below it re-populated. */}
      <form className="flex items-end gap-3" method="get">
        <input name="tab" type="hidden" value="update" />
        <div className="flex-1 space-y-1">
          <label className="block text-sm font-medium text-slate-700" htmlFor="pick">
            Student to update
          </label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            defaultValue={pick}
            id="pick"
            name="pick"
          >
            <option value="">(choose a student)</option>
            {students.map((student) => (
              <option key={student.student_id} value={student.student_id}>
                {student.student_name} — {student.student_no}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton variant="plain">Load</SubmitButton>
      </form>

      {current === undefined ? (
        <p className="text-sm text-slate-500">Choose a student to load its current values.</p>
      ) : (
        <form action={updateStudentAction} className="space-y-4 border-t border-slate-200 pt-4">
          <input name="student_id" type="hidden" value={current.student_id} />
          <input name="student_no_label" type="hidden" value={current.student_no} />

          <p className="text-sm text-slate-700">
            Editing <strong>{current.student_name}</strong> ({current.student_no})
          </p>

          <EntityPicker
            defaultValue={String(departments.find((d) => d.label === current.dept_name)?.value ?? "")}
            label="Department"
            name="department_id"
            options={departments}
            required
          />
          <SelectField
            choices={LEVELS}
            defaultValue={current.program_level}
            label="Programme level"
            name="program_level"
          />
          <Field
            defaultValue={current.enrollment_year}
            label="Enrolment year"
            max={2100}
            min={2000}
            name="enrollment_year"
            required
            type="number"
          />
          {/* A student cannot be their own advisor, so the current row is
              excluded -- the same filter the Python screen applied. */}
          <EntityPicker
            defaultValue={current.student_id === Number(pick) ? "" : undefined}
            hint="A student cannot be their own advisor."
            label="Advisor"
            name="advisor_id"
            options={optionsFrom(
              (students as unknown as Record<string, unknown>[]).filter(
                (s) => String(s.student_id) !== pick,
              ),
              "student_id",
              "student_name",
            )}
          />

          <SubmitButton>Save changes</SubmitButton>
        </form>
      )}
    </div>
  );
}

async function DeleteTab() {
  const students = await listStudents();

  return (
    <div className="max-w-2xl space-y-4">
      <Flash
        kind="warning"
        message="Deleting a student profile cascades to that student's enrolments, submissions and attendance records. The login account itself is kept."
      />

      {students.length === 0 ? (
        <p className="text-sm text-slate-500">No students to delete.</p>
      ) : (
        <div className="overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Student</th>
                <th className="px-3 py-2 font-medium">Number</th>
                <th className="px-3 py-2 font-medium">Department</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr className="border-t border-slate-100" key={student.student_id}>
                  <td className="px-3 py-2 font-medium text-slate-900">{student.student_name}</td>
                  <td className="px-3 py-2 text-slate-700">{student.student_no}</td>
                  <td className="px-3 py-2 text-slate-700">{student.dept_name}</td>
                  <td className="px-3 py-2">
                    <form action={deleteStudentAction}>
                      {/* The id and label come from this server-rendered row, so a
                          tampered form can still only delete a real student -- but the
                          label is display text and is never trusted for anything. */}
                      <input name="student_id" type="hidden" value={student.student_id} />
                      <input name="student_no_label" type="hidden" value={student.student_no} />
                      <SubmitButton variant="danger">Delete permanently</SubmitButton>
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
