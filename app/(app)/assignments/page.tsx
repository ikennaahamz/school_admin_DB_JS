import { DataTable } from "@/components/DataTable";
import { EntityPicker, optionsFrom } from "@/components/EntityPicker";
import { Field, SubmitButton, Tabs, TextArea } from "@/components/Form";
import { Flash } from "@/components/Flash";
import {
  deleteAssignmentAction,
  gradeSubmissionAction,
  insertAssignmentAction,
} from "@/lib/actions/crud";
import { readFlash } from "@/lib/flash";
import { requireScreen } from "@/lib/guard";
import { listAssignments } from "@/lib/queries/assignments";
import { listSubmissions, listUnmarkedSubmissions } from "@/lib/queries/lookups";
import { listSections } from "@/lib/queries/sections";

/** Assignments & submissions. */

const TABS = [
  { key: "list", label: "Assignments" },
  { key: "insert", label: "Insert" },
  { key: "delete", label: "Delete" },
  { key: "submissions", label: "Submissions" },
  { key: "grade", label: "Grade a submission" },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function AssignmentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireScreen("assignments");

  const params = await searchParams;
  const tab = TABS.some((t) => t.key === first(params.tab)) ? first(params.tab) : "list";
  const flash = readFlash(params);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Assignments &amp; Submissions</h1>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      <Tabs active={tab} tabs={TABS} />

      {tab === "list" ? <ListTab /> : null}
      {tab === "insert" ? <InsertTab /> : null}
      {tab === "delete" ? <DeleteTab /> : null}
      {tab === "submissions" ? <SubmissionsTab /> : null}
      {tab === "grade" ? <GradeTab /> : null}
    </div>
  );
}

async function ListTab() {
  const rows = await listAssignments();

  return (
    <DataTable
      caption="Assignments"
      columns={[
        { key: "course_code", header: "Course" },
        { key: "title", header: "Title" },
        { key: "weight", header: "Weight", numeric: true },
        { key: "max_points", header: "Max points", numeric: true },
        { key: "due_date", header: "Due" },
        { key: "submitted", header: "Submitted", numeric: true },
        { key: "enrolled", header: "Enrolled", numeric: true },
        { key: "avg_score", header: "Avg score", numeric: true },
      ]}
      rows={rows as unknown as Record<string, unknown>[]}
    />
  );
}

async function InsertTab() {
  const sections = await listSections();

  return (
    <form action={insertAssignmentAction} className="max-w-2xl space-y-4">
      <EntityPicker
        label="Section"
        name="section_id"
        options={optionsFrom(sections as unknown as Record<string, unknown>[], "section_id", "course_name")}
        required
      />
      <Field label="Title" name="title" required />
      <Field defaultValue={10} label="Weight (%)" max={100} min={0.5} name="weight" required step={0.5} type="number" />
      <Field defaultValue={100} label="Max points" max={1000} min={1} name="max_points" required type="number" />
      <Field label="Due date" name="due_date" required type="date" />

      <SubmitButton>Insert assignment</SubmitButton>
    </form>
  );
}

async function DeleteTab() {
  const rows = await listAssignments();

  return (
    <div className="max-w-2xl space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No assignments to delete.</p>
      ) : (
        <div className="overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Course</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-slate-100" key={row.assignment_id}>
                  <td className="px-3 py-2 text-slate-900">{row.course_code}</td>
                  <td className="px-3 py-2 text-slate-700">{row.title}</td>
                  <td className="px-3 py-2 text-slate-700">{row.due_date}</td>
                  <td className="px-3 py-2">
                    <form action={deleteAssignmentAction}>
                      <input name="assignment_id" type="hidden" value={row.assignment_id} />
                      <input name="label" type="hidden" value={`${row.course_code} — ${row.title}`} />
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

async function SubmissionsTab() {
  const rows = await listSubmissions();

  // is_late comes back as a boolean, which would render as "true"/"false".
  // DataTable has no cell renderer by design -- see the note on Column --
  // so the display value is prepared here instead.
  const display = rows.map((row) => ({ ...row, is_late: row.is_late ? "yes" : "no" }));

  return (
    <DataTable
      caption="Submissions"
      columns={[
        { key: "course_code", header: "Course" },
        { key: "title", header: "Assignment" },
        { key: "student_no", header: "Student no" },
        { key: "student_name", header: "Student" },
        { key: "submitted_at", header: "Submitted" },
        { key: "score", header: "Score", numeric: true },
        { key: "pct", header: "%", numeric: true },
        { key: "is_late", header: "Late" },
      ]}
      rows={display as unknown as Record<string, unknown>[]}
    />
  );
}

async function GradeTab() {
  const rows = await listUnmarkedSubmissions();

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-slate-600">{rows.length} submissions awaiting a mark</p>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Every submission has been marked.</p>
      ) : (
        rows.map((row) => (
          <form
            action={gradeSubmissionAction}
            className="space-y-3 rounded-md border border-slate-200 p-4"
            key={row.submission_id}
          >
            <input name="submission_id" type="hidden" value={row.submission_id} />

            <p className="text-sm text-slate-700">
              <strong>{row.student_name}</strong> — {row.title} ({row.course_code})
            </p>

            <Field
              defaultValue={0}
              label={`Score (out of ${row.max_points})`}
              max={Number(row.max_points)}
              min={0}
              name="score"
              required
              step={0.5}
              type="number"
            />
            <TextArea label="Feedback" name="feedback" />

            <SubmitButton>Save mark</SubmitButton>
          </form>
        ))
      )}
    </div>
  );
}
