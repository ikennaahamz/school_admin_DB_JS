import { DataTable } from "@/components/DataTable";
import { EntityPicker, optionsFrom } from "@/components/EntityPicker";
import { Field, SelectField, SubmitButton, Tabs } from "@/components/Form";
import { Flash } from "@/components/Flash";
import {
  deleteSectionAction,
  insertSectionAction,
  updateSectionAction,
} from "@/lib/actions/crud";
import { readFlash } from "@/lib/flash";
import { requireScreen } from "@/lib/guard";
import { listInstructors } from "@/lib/queries/instructors";
import { listClassrooms } from "@/lib/queries/lookups";
import { listSections } from "@/lib/queries/sections";

/** Courses & sections. */

const TABS = [
  { key: "view", label: "View" },
  { key: "insert", label: "Insert" },
  { key: "update", label: "Update" },
  { key: "delete", label: "Delete" },
];

const TERMS = ["Fall", "Spring", "Summer"] as const;
const CREDITS = ["1", "2", "3", "4", "5", "6"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function SectionsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireScreen("sections");

  const params = await searchParams;
  const tab = TABS.some((t) => t.key === first(params.tab)) ? first(params.tab) : "view";
  const flash = readFlash(params);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Courses &amp; Sections</h1>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      <Tabs active={tab} tabs={TABS} />

      {tab === "view" ? <ViewTab params={params} /> : null}
      {tab === "insert" ? <InsertTab /> : null}
      {tab === "update" ? <UpdateTab params={params} /> : null}
      {tab === "delete" ? <DeleteTab /> : null}
    </div>
  );
}

async function ViewTab({ params }: { params: Record<string, string | string[] | undefined> }) {
  const term = first(params.term);
  const year = first(params.year);
  const rows = await listSections(term === "" ? null : term, year === "" ? null : Number(year));

  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-3" method="get">
        <input name="tab" type="hidden" value="view" />
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700" htmlFor="term">
            Term
          </label>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            defaultValue={term}
            id="term"
            name="term"
          >
            <option value="">(all)</option>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700" htmlFor="year">
            Year
          </label>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            defaultValue={year}
            id="year"
            name="year"
          >
            <option value="">(all)</option>
            <option value="2025">2025</option>
            <option value="2026">2026</option>
          </select>
        </div>
        <SubmitButton variant="plain">Apply</SubmitButton>
      </form>

      <DataTable
        caption="Course sections"
        columns={[
          { key: "course_code", header: "Code" },
          { key: "course_name", header: "Course" },
          { key: "term", header: "Term" },
          { key: "academic_year", header: "Year", numeric: true },
          { key: "credits", header: "Credits", numeric: true },
          { key: "instructor", header: "Instructor" },
          { key: "room", header: "Room" },
          { key: "capacity", header: "Capacity", numeric: true },
          { key: "enrolled_count", header: "Enrolled", numeric: true },
          // Computed by the PL/pgSQL function section_fill_ratio().
          { key: "fill_pct", header: "Fill %", numeric: true },
        ]}
        rows={rows as unknown as Record<string, unknown>[]}
      />
    </div>
  );
}

async function InsertTab() {
  const instructors = await listInstructors();
  const classrooms = await listClassrooms();

  return (
    <form action={insertSectionAction} className="max-w-2xl space-y-4">
      <Field defaultValue="CS" label="Course code" maxLength={12} name="course_code" required />
      <Field label="Course name" name="course_name" required />
      <SelectField choices={TERMS} label="Term" name="term" />
      <Field defaultValue={2025} label="Academic year" max={2100} min={2020} name="academic_year" required type="number" />
      <EntityPicker
        label="Instructor"
        name="instructor_id"
        options={optionsFrom(instructors as unknown as Record<string, unknown>[], "instructor_id", "instructor_name")}
      />
      <EntityPicker label="Classroom" name="classroom_id" options={optionsFrom(classrooms, "classroom_id", "room")} />
      <SelectField choices={CREDITS} label="Credits" name="credits" />
      <Field defaultValue={30} label="Capacity" max={500} min={1} name="capacity" required type="number" />

      <SubmitButton>Insert section</SubmitButton>
    </form>
  );
}

async function UpdateTab({ params }: { params: Record<string, string | string[] | undefined> }) {
  const sections = await listSections();
  const instructors = await listInstructors();
  const classrooms = await listClassrooms();
  const pick = first(params.pick);
  const current = sections.find((s) => String(s.section_id) === pick);

  return (
    <div className="max-w-2xl space-y-4">
      <form className="flex items-end gap-3" method="get">
        <input name="tab" type="hidden" value="update" />
        <div className="flex-1 space-y-1">
          <label className="block text-sm font-medium text-slate-700" htmlFor="pick">
            Section to update
          </label>
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            defaultValue={pick}
            id="pick"
            name="pick"
          >
            <option value="">(choose a section)</option>
            {sections.map((s) => (
              <option key={s.section_id} value={s.section_id}>
                {s.course_code} — {s.course_name}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton variant="plain">Load</SubmitButton>
      </form>

      {current === undefined ? (
        <p className="text-sm text-slate-500">Choose a section to load its current values.</p>
      ) : (
        <form action={updateSectionAction} className="space-y-4 border-t border-slate-200 pt-4">
          <input name="section_id" type="hidden" value={current.section_id} />
          <input name="code_label" type="hidden" value={current.course_code} />

          <p className="text-sm text-slate-700">
            Editing <strong>{current.course_code}</strong> — {current.course_name}
          </p>

          <EntityPicker
            label="Instructor"
            name="instructor_id"
            options={optionsFrom(instructors as unknown as Record<string, unknown>[], "instructor_id", "instructor_name")}
          />
          <EntityPicker
            label="Classroom"
            name="classroom_id"
            options={optionsFrom(classrooms, "classroom_id", "room")}
          />
          <Field
            defaultValue={current.capacity}
            hint={`Currently ${current.enrolled_count} enrolled. Capacity cannot drop below that.`}
            label="Capacity"
            max={500}
            min={1}
            name="capacity"
            required
            type="number"
          />

          <SubmitButton>Save changes</SubmitButton>
        </form>
      )}
    </div>
  );
}

async function DeleteTab() {
  const sections = await listSections();

  return (
    <div className="max-w-2xl space-y-4">
      <Flash
        kind="warning"
        message="Deleting a section cascades to its enrolments, assignments, submissions and attendance rows."
      />

      {sections.length === 0 ? (
        <p className="text-sm text-slate-500">No sections to delete.</p>
      ) : (
        <div className="overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Course</th>
                <th className="px-3 py-2 font-medium">Term</th>
                <th className="px-3 py-2 font-medium">Enrolled</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <tr className="border-t border-slate-100" key={section.section_id}>
                  <td className="px-3 py-2 font-medium text-slate-900">{section.course_code}</td>
                  <td className="px-3 py-2 text-slate-700">{section.course_name}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {section.term} {section.academic_year}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {section.enrolled_count}/{section.capacity}
                  </td>
                  <td className="px-3 py-2">
                    <form action={deleteSectionAction}>
                      <input name="section_id" type="hidden" value={section.section_id} />
                      <input name="code_label" type="hidden" value={section.course_code} />
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
