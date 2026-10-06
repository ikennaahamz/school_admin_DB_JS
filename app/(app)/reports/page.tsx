import { DataTable } from "@/components/DataTable";
import { SubmitButton, Tabs } from "@/components/Form";
import { Flash } from "@/components/Flash";
import { readFlash } from "@/lib/flash";
import { requireScreen } from "@/lib/guard";
import { listGradeAudit } from "@/lib/queries/lookups";
import { REPORTS, demoProcedures, run } from "@/lib/reports";
import { describeColumns } from "@/lib/stats";

/**
 * Management reports.
 *
 * Reachable by students too -- it is one of only two screens a `student`
 * role may open, and it is the reason `SCREENS` in `lib/nav.ts` lists
 * `student` against it.
 */

const TABS = [
  { key: "results", label: "Results" },
  { key: "sql", label: "SQL source" },
  { key: "plpgsql", label: "PL/pgSQL output" },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function reportByKey(key: string) {
  return REPORTS.find((r) => r.key === key) ?? REPORTS[0];
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireScreen("reports");

  const params = await searchParams;
  const tab = TABS.some((t) => t.key === first(params.tab)) ? first(params.tab) : "results";
  const flash = readFlash(params);
  const chosen = reportByKey(first(params.report) || "q1").key;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">Management Reports</h1>
        <p className="text-sm text-slate-600">
          Eight analytical queries run against the live database through the same connection the
          rest of the application uses.
        </p>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      <Tabs active={tab} tabs={TABS} />

      {tab === "results" ? <ResultsTab chosen={chosen} /> : null}
      {tab === "sql" ? <SqlTab chosen={chosen} /> : null}
      {tab === "plpgsql" ? <PlpgsqlTab /> : null}
    </div>
  );
}

/** A picker shared by the results and SQL tabs. */
function ReportPicker({ chosen, forTab }: { chosen: string; forTab: string }) {
  return (
    <form className="flex items-end gap-3" method="get">
      <input name="tab" type="hidden" value={forTab} />
      <div className="min-w-80 space-y-1">
        <label className="block text-sm font-medium text-slate-700" htmlFor="report">
          Report
        </label>
        <select
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          defaultValue={chosen}
          id="report"
          name="report"
        >
          {REPORTS.map((report) => (
            <option key={report.key} value={report.key}>
              {report.title}
            </option>
          ))}
        </select>
      </div>
      <SubmitButton variant="plain">Run</SubmitButton>
    </form>
  );
}

async function ResultsTab({ chosen }: { chosen: string }) {
  const report = reportByKey(chosen);
  const rows = (await run(chosen)) as unknown as Record<string, unknown>[];
  const stats = describeColumns(rows);

  // Every column of a report is numeric-looking or not; the generic
  // DataTable needs to be told which, because pg hands both back as
  // strings. `numeric: true` is only right for the numeric ones.
  const columns = rows.length === 0 ? [] : Object.keys(rows[0]).map((key) => ({
    key,
    header: key,
    numeric: stats.some((s) => s.key === key),
  }));

  const csv = [columns.map((c) => c.key).join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(","))].join(
    "\n",
  );

  return (
    <div className="space-y-3">
      <ReportPicker chosen={chosen} forTab="results" />

      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        {report.question}
      </div>
      <p className="text-xs text-slate-500">SQL features: {report.features}</p>

      <p className="text-sm text-slate-500">{rows.length} rows</p>

      <DataTable caption={report.title} columns={columns} rows={rows} />

      {stats.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">Summary statistics</h2>
          <DataTable
            caption={`Summary statistics for ${report.title}`}
            columns={[
              { key: "key", header: "Column" },
              { key: "count", header: "Count", numeric: true },
              { key: "mean", header: "Mean", numeric: true },
              { key: "stdev", header: "Std dev", numeric: true },
              { key: "min", header: "Min", numeric: true },
              { key: "max", header: "Max", numeric: true },
              { key: "sum", header: "Sum", numeric: true },
            ]}
            rows={stats as unknown as Record<string, unknown>[]}
          />
        </section>
      ) : null}

      <a
        className="inline-block rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        download={`${chosen}.csv`}
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
      >
        Download as CSV
      </a>
    </div>
  );
}

/** RFC 4180 escaping, or a naive join and the CSV is subtly wrong. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function SqlTab({ chosen }: { chosen: string }) {
  const report = reportByKey(chosen);

  return (
    <div className="space-y-3">
      <ReportPicker chosen={chosen} forTab="sql" />
      <p className="text-sm text-slate-700">{report.title}</p>
      {/* The SQL is shown from the same string the application executes, so
          what the report displays cannot drift from what it ran. */}
      <pre className="overflow-auto rounded-md border border-slate-200 bg-slate-50 p-4 text-xs">
        <code>{report.sql}</code>
      </pre>
    </div>
  );
}

async function PlpgsqlTab() {
  const [demo, audit] = await Promise.all([demoProcedures(), listGradeAudit(25, false)]);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-semibold text-slate-900">Procedural blocks, executed live</h2>
        <p className="text-sm text-slate-600">
          Each row below is this application calling a PL/pgSQL function or procedure and showing
          what came back. The two refusals are the procedure&apos;s own{" "}
          <code>RAISE EXCEPTION</code> messages.
        </p>

        <DataTable
          caption="PL/pgSQL demonstration"
          columns={[
            { key: "block", header: "Block" },
            { key: "type", header: "Type" },
            { key: "returns", header: "Returned" },
            { key: "note", header: "Note" },
          ]}
          rows={demo as unknown as Record<string, unknown>[]}
        />
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-900">Grade audit trail</h2>
        <DataTable
          caption="Grade audit trail"
          columns={[
            { key: "changed_at", header: "Changed" },
            { key: "changed_by", header: "By" },
            { key: "student_no", header: "Student no" },
            { key: "course_code", header: "Course" },
            { key: "old_grade", header: "Old", numeric: true },
            { key: "new_grade", header: "New", numeric: true },
            { key: "old_letter", header: "Old letter" },
            { key: "new_letter", header: "New letter" },
          ]}
          rows={audit as unknown as Record<string, unknown>[]}
        />
      </section>
    </div>
  );
}
