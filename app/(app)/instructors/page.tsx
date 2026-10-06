import { DataTable } from "@/components/DataTable";
import { EntityPicker, optionsFrom } from "@/components/EntityPicker";
import { Field, SelectField, SubmitButton, Tabs } from "@/components/Form";
import { Flash } from "@/components/Flash";
import {
  deleteInstructorAction,
  insertInstructorAction,
  updateInstructorAction,
} from "@/lib/actions/crud";
import { readFlash } from "@/lib/flash";
import { requireScreen } from "@/lib/guard";
import { listInstructors } from "@/lib/queries/instructors";
import { listDepartments } from "@/lib/queries/lookups";

/** Instructors. `st.tabs` ported as `?tab=` links. */

const TABS = [
  { key: "view", label: "View" },
  { key: "insert", label: "Insert" },
  { key: "update", label: "Update" },
  { key: "delete", label: "Delete" },
];

const RANKS = ["Lecturer", "Assistant Professor", "Associate Professor", "Professor"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function InstructorsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireScreen("instructors");

  const params = await searchParams;
  const tab = TABS.some((t) => t.key === first(params.tab)) ? first(params.tab) : "view";
  const flash = readFlash(params);

  const departments = await listDepartments();
  const deptOptions = optionsFrom(departments, "department_id", "dept_name");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Instructors</h1>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      <Tabs active={tab} tabs={TABS} />

      {tab === "view" ? <ViewTab /> : null}
      {tab === "insert" ? <InsertTab departments={deptOptions} /> : null}
      {tab === "update" ? <UpdateTab departments={deptOptions} params={params} /> : null}
      {tab === "delete" ? <DeleteTab /> : null}
    </div>
  );
}

async function ViewTab() {
  const rows = await listInstructors();

  return (
    <DataTable
      caption="Instructors"
      columns={[
        { key: "employee_no", header: "Employee no" },
        { key: "instructor_name", header: "Name" },
        { key: "email", header: "Email" },
        { key: "status", header: "Status" },
        { key: "dept_name", header: "Department" },
        { key: "rank_title", header: "Rank" },
        { key: "hire_date", header: "Hired", sortable: true },
        { key: "salary", header: "Salary", numeric: true },
        { key: "sections_taught", header: "Sections", numeric: true },
      ]}
      rows={rows as unknown as Record<string, unknown>[]}
    />
  );
}

async function InsertTab({ departments }: { departments: { value: string; label: string }[] }) {
  return (
    <form action={insertInstructorAction} className="max-w-2xl space-y-4">
      <Field autoComplete="off" hint="The login this profile belongs to." label="Existing username" name="username" required />
      <Field defaultValue="E-" label="Employee number" name="employee_no" required />
      <EntityPicker label="Department" name="department_id" options={departments} required />
      <SelectField choices={RANKS} label="Rank" name="rank_title" />
      <Field label="Hire date" name="hire_date" required type="date" />
      <Field defaultValue={60000} label="Salary" max={1_000_000} min={0} name="salary" step={1000} type="number" />

      <SubmitButton>Insert instructor</SubmitButton>
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
  const instructors = await listInstructors();
  const pick = first(params.pick);
  const current = instructors.find((i) => String(i.instructor_id) === pick);

  return (
    <div className="max-w-2xl space-y-4">
      <form className="flex items-end gap-3" method="get">
        <input name="tab" type="hidden" value="update" />
        <div className="flex-1 space-y-1">
          <label className="block text-sm font-medium text-slate-700" htmlFor="pick">
            Instructor to update
          </label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            defaultValue={pick}
            id="pick"
            name="pick"
          >
            <option value="">(choose an instructor)</option>
            {instructors.map((i) => (
              <option key={i.instructor_id} value={i.instructor_id}>
                {i.instructor_name} — {i.employee_no}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton variant="plain">Load</SubmitButton>
      </form>

      {current === undefined ? (
        <p className="text-sm text-slate-500">Choose an instructor to load its current values.</p>
      ) : (
        <form action={updateInstructorAction} className="space-y-4 border-t border-slate-200 pt-4">
          <input name="instructor_id" type="hidden" value={current.instructor_id} />
          <input name="name_label" type="hidden" value={current.instructor_name} />

          <p className="text-sm text-slate-700">
            Editing <strong>{current.instructor_name}</strong>
          </p>

          <EntityPicker
            defaultValue={String(departments.find((d) => d.label === current.dept_name)?.value ?? "")}
            label="Department"
            name="department_id"
            options={departments}
            required
          />
          <SelectField choices={RANKS} defaultValue={current.rank_title} label="Rank" name="rank_title" />
          <Field
            defaultValue={Number(current.salary ?? 0)}
            label="Salary"
            max={1_000_000}
            min={0}
            name="salary"
            step={1000}
            type="number"
          />

          <SubmitButton>Save changes</SubmitButton>
        </form>
      )}
    </div>
  );
}

async function DeleteTab() {
  const instructors = await listInstructors();

  return (
    <div className="max-w-2xl space-y-4">
      <Flash
        kind="info"
        message="Course sections keep their enrolment history: deleting an instructor leaves their sections unassigned rather than removing them."
      />

      {instructors.length === 0 ? (
        <p className="text-sm text-slate-500">No instructors to delete.</p>
      ) : (
        <div className="overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Instructor</th>
                <th className="px-3 py-2 font-medium">Number</th>
                <th className="px-3 py-2 font-medium">Sections</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {instructors.map((instructor) => (
                <tr className="border-t border-slate-100" key={instructor.instructor_id}>
                  <td className="px-3 py-2 font-medium text-slate-900">{instructor.instructor_name}</td>
                  <td className="px-3 py-2 text-slate-700">{instructor.employee_no}</td>
                  <td className="px-3 py-2 text-slate-700">{instructor.sections_taught}</td>
                  <td className="px-3 py-2">
                    <form action={deleteInstructorAction}>
                      <input name="instructor_id" type="hidden" value={instructor.instructor_id} />
                      <input name="name_label" type="hidden" value={instructor.instructor_name} />
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
