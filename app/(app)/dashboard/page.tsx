import { Flash } from "@/components/Flash";
import { DataTable } from "@/components/DataTable";
import { DatabaseError, ping, query, tableCount } from "@/lib/db";
import { readFlash } from "@/lib/flash";
import { requireScreen } from "@/lib/guard";
import { run } from "@/lib/reports";
import { listSections } from "@/lib/queries/sections";

/**
 * Dashboard.
 *
 * Reachable by anyone signed in -- its screen entry declares no roles, so
 * `requireScreen` admits every authenticated user including `student`.
 */

const TILES = [
  { label: "Students", table: "students" },
  { label: "Instructors", table: "instructors" },
  { label: "Course sections", table: "course_sections" },
  { label: "Enrolments", table: "enrollments" },
  { label: "Assignments", table: "assignments" },
  { label: "Attendance rows", table: "attendance" },
] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireScreen("dashboard");
  const flash = readFlash(await searchParams);

  // The Python app pinged the database once per session and refused to
  // draw anything if it failed. Here the connection status is worth
  // showing but not worth blocking on: a page whose data has loaded has
  // already proved the database is reachable.
  const [connected, version] = await ping();

  const counts = await Promise.all(
    TILES.map(async (tile) => {
      try {
        // `error: undefined` on the success branch too, so the mapped
        // array is one type rather than a union with the key present on
        // only one arm.
        return { ...tile, count: (await tableCount(tile.table)).toLocaleString("en-US"), error: undefined };
      } catch (err) {
        // A per-tile failure, as in the Python original, so one bad count
        // does not blank the dashboard.
        return {
          ...tile,
          count: "—",
          error: err instanceof DatabaseError ? err.message.slice(0, 60) : "unavailable",
        };
      }
    }),
  );

  const sections = await listSections("Fall", 2025);
  const distribution = await run<{ band: string; records: string; pct_of_cohort: string; avg_in_band: string }>("q5");
  const departments = await query<{
    dept_code: string;
    dept_name: string;
    established_year: number;
    annual_budget: string;
  }>(`
        SELECT dept_code, dept_name, established_year,
               annual_budget
          FROM departments ORDER BY dept_code
        `);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-600">
          Signed in as <strong>{user.full_name}</strong> ({user.roles.join("/")}, access level{" "}
          {user.access_level})
        </p>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      {!connected ? (
        <Flash kind="error" message={`Not connected to the database. ${version}`} />
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {counts.map((tile) => (
          <div
            className="rounded-md border border-slate-200 p-3"
            data-testid="metric-tile"
            key={tile.table}
            title={tile.error}
          >
            <p className="text-xs text-slate-500">{tile.label}</p>
            <p className="text-xl font-semibold tabular-nums text-slate-900">{tile.count}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">Sections by capacity</h2>
          <DataTable
            columns={[
              { key: "course_code", header: "Code" },
              { key: "instructor", header: "Instructor" },
              { key: "capacity", header: "Cap", numeric: true },
              { key: "enrolled_count", header: "Enrolled", numeric: true },
              { key: "fill_pct", header: "Fill %", numeric: true },
            ]}
            rows={sections as unknown as Record<string, unknown>[]}
          />
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">Grade distribution</h2>
          <DataTable
            columns={[
              { key: "band", header: "Band" },
              { key: "records", header: "Records", numeric: true },
              { key: "pct_of_cohort", header: "% of cohort", numeric: true },
              { key: "avg_in_band", header: "Avg", numeric: true },
            ]}
            rows={distribution as unknown as Record<string, unknown>[]}
          />
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-900">Departments</h2>
        <DataTable
          columns={[
            { key: "dept_code", header: "Code" },
            { key: "dept_name", header: "Name" },
            { key: "established_year", header: "Established", numeric: true },
            { key: "annual_budget", header: "Annual budget", numeric: true },
          ]}
          rows={departments as unknown as Record<string, unknown>[]}
        />
      </section>
    </div>
  );
}
