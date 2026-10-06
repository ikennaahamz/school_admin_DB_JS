import { DataTable } from "@/components/DataTable";
import { EntityPicker, optionsFrom } from "@/components/EntityPicker";
import { Field, SelectField, SubmitButton, Tabs } from "@/components/Form";
import { Flash } from "@/components/Flash";
import { deleteAttendanceAction, recordAttendanceAction } from "@/lib/actions/crud";
import { readFlash } from "@/lib/flash";
import { requireScreen } from "@/lib/guard";
import { listAttendance } from "@/lib/queries/attendance";
import { listSections } from "@/lib/queries/sections";
import { listStudents } from "@/lib/queries/students";

/** Attendance. */

const TABS = [
  { key: "view", label: "View" },
  { key: "mark", label: "Record" },
  { key: "delete", label: "Delete" },
];

const STATUSES = ["present", "absent", "late", "excused"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function AttendancePage({ searchParams }: { searchParams: SearchParams }) {
  await requireScreen("attendance");

  const params = await searchParams;
  const tab = TABS.some((t) => t.key === first(params.tab)) ? first(params.tab) : "view";
  const flash = readFlash(params);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Attendance</h1>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      <Tabs active={tab} tabs={TABS} />

      {tab === "view" ? <ViewTab params={params} /> : null}
      {tab === "mark" ? <MarkTab /> : null}
      {tab === "delete" ? <DeleteTab /> : null}
    </div>
  );
}

async function ViewTab({ params }: { params: Record<string, string | string[] | undefined> }) {
  const sections = await listSections();
  const sectionId = first(params.section_id);
  const rows = await listAttendance(sectionId === "" ? null : Number(sectionId));

  return (
    <div className="space-y-3">
      <form className="flex items-end gap-3" method="get">
        <input name="tab" type="hidden" value="view" />
        <div className="min-w-64 space-y-1">
          <label className="block text-sm font-medium text-slate-700" htmlFor="section_id">
            Section
          </label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            defaultValue={sectionId}
            id="section_id"
            name="section_id"
          >
            <option value="">(all)</option>
            {sections.map((section) => (
              <option key={section.section_id} value={section.section_id}>
                {section.course_code} — {section.course_name}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton variant="plain">Apply</SubmitButton>
      </form>

      <DataTable
        caption="Attendance records"
        columns={[
          { key: "course_code", header: "Course" },
          { key: "student_no", header: "Student no" },
          { key: "student_name", header: "Student" },
          { key: "session_date", header: "Session" },
          { key: "status", header: "Status" },
        ]}
        empty="No attendance recorded."
        rows={rows as unknown as Record<string, unknown>[]}
      />
    </div>
  );
}

async function MarkTab() {
  const [sections, students] = await Promise.all([listSections(), listStudents()]);

  return (
    <form action={recordAttendanceAction} className="max-w-xl space-y-4">
      <p className="text-sm text-slate-600">
        Saving the same session twice corrects the earlier value rather than creating a duplicate
        row — the write is an <code>ON CONFLICT</code> upsert on (section, student, date).
      </p>

      <EntityPicker
        label="Section"
        name="section_id"
        options={optionsFrom(sections as unknown as Record<string, unknown>[], "section_id", "course_name")}
        required
      />
      <EntityPicker
        label="Student"
        name="student_id"
        options={optionsFrom(students as unknown as Record<string, unknown>[], "student_id", "student_name")}
        required
      />
      <Field label="Session date" name="session_date" required type="date" />
      <SelectField choices={STATUSES} label="Status" name="status" />

      <SubmitButton>Save attendance</SubmitButton>
    </form>
  );
}

async function DeleteTab() {
  const rows = await listAttendance();

  return (
    <div className="max-w-2xl space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No attendance records to delete.</p>
      ) : (
        <div className="overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Student</th>
                <th className="px-3 py-2 font-medium">Course</th>
                <th className="px-3 py-2 font-medium">Session</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-slate-100" key={row.attendance_id}>
                  <td className="px-3 py-2 text-slate-900">{row.student_name}</td>
                  <td className="px-3 py-2 text-slate-700">{row.course_code}</td>
                  <td className="px-3 py-2 text-slate-700">{row.session_date}</td>
                  <td className="px-3 py-2 text-slate-700">{row.status}</td>
                  <td className="px-3 py-2">
                    <form action={deleteAttendanceAction}>
                      <input name="attendance_id" type="hidden" value={row.attendance_id} />
                      <input
                        name="label"
                        type="hidden"
                        value={`${row.student_name} — ${row.course_code} ${row.session_date}`}
                      />
                      <SubmitButton variant="danger">Delete</SubmitButton>
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
