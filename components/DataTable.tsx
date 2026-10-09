"use client";

/**
 * The read-only table.
 *
 * Replaces `st.dataframe`, which every screen in the Python app used through
 * `screens.py::_show_table`.
 *
 * Why this is hand-written rather than TanStack Table
 * ---------------------------------------------------
 * The port plan assumed `@tanstack/react-table`'s v8 API. The installed
 * version is v9, which is a different design: features are registered
 * against a `TableFeatures` type, and cell and header components are bound
 * through a `createTableHook` factory. That is a great deal of machinery
 * for a table whose whole job is "show rows, sort by a clicked column".
 *
 * It is also ~20 kB of client JavaScript for functionality that is about
 * seventy lines here, and -- the reason that actually decided it -- the one
 * non-obvious requirement is the numeric comparator below, which a generic
 * table would have to be told about through three layers of options
 * anyway.
 *
 * The sorting rule that matters
 * -----------------------------
 * `pg` returns NUMERIC and bigint as *strings*. A grade of "10" therefore
 * sorts before "9" under a string comparator, which is visibly wrong in a
 * column of marks. Columns declared `numeric` are compared as numbers.
 * Handing this to a generic table is how that bug gets shipped, so the
 * comparator lives here where it can be seen.
 */

import { useMemo, useState } from "react";

export type Column = {
  key: string;
  header: string;
  /** Compare and align as a number. See the note above. */
  numeric?: boolean;
  /** Values that should not participate in sorting are handled per-cell. */
  sortable?: boolean;
};

/**
 * Note what this type deliberately does NOT have: a `render` function.
 *
 * An earlier version allowed one, and it looked useful. It cannot work
 * from a Server Component, because `DataTable` is `"use client"` and a
 * function cannot cross the server/client boundary -- the page fails with
 * "Functions cannot be passed directly to Client Components". Screens only
 * got away with it by never passing one, which is exactly the kind of trap
 * that waits for the next person.
 *
 * A cell needing custom markup belongs in a table written in the screen
 * itself, which is what the CRUD delete tabs and the admin accounts table
 * do. Server actions *can* cross the boundary, so a form in a cell is
 * fine; it is only function-valued props that break.
 */

type Sort = { key: string; direction: "asc" | "desc" } | null;

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  empty = "No records.",
  maxHeight = 420,
  caption,
}: {
  columns: Column[];
  rows: T[];
  empty?: string;
  maxHeight?: number;
  caption?: string;
}) {
  const [sort, setSort] = useState<Sort>(null);

  const sorted = useMemo(() => {
    if (sort === null) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (column === undefined) return rows;

    const sign = sort.direction === "asc" ? 1 : -1;
    // Copied before sorting: `rows` is often the result of a query mapped
    // into a fresh array, but not always, and sorting a prop in place is
    // a bug that only shows up sometimes.
    return [...rows].sort((a, b) => sign * compare(a[column.key], b[column.key], column.numeric === true));
  }, [rows, sort, columns]);

  if (rows.length === 0) {
    return <p className="py-4 text-sm text-slate-500">{empty}</p>;
  }

  function toggle(key: string, sortable: boolean) {
    if (!sortable) return;
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null; // third click restores the database's own ordering
    });
  }

  return (
    <div
      className="overflow-auto rounded-md border border-slate-200"
      style={{ maxHeight }}
    >
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 bg-slate-50 text-left">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const indicator = active ? (sort.direction === "asc" ? " ▲" : " ▼") : "";
              return (
                <th
                  aria-sort={
                    active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={`px-3 py-2 font-medium whitespace-nowrap text-slate-700 ${
                    column.numeric ? "text-right" : ""
                  }`}
                  key={column.key}
                  scope="col"
                >
                  {column.sortable === false ? (
                    column.header
                  ) : (
                    <button
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                      onClick={() => toggle(column.key, column.sortable !== false)}
                      type="button"
                    >
                      {column.header}
                      {indicator}
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr className="border-t border-slate-100" key={index}>
              {columns.map((column) => (
                <td
                  className={`px-3 py-1.5 text-slate-800 ${
                    column.numeric ? "text-right tabular-nums" : ""
                  }`}
                  key={column.key}
                >
                  {format(row[column.key], column.numeric === true)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function format(value: unknown, numeric: boolean): string {
  if (value === null || value === undefined || value === "") return "—";
  if (numeric) {
    const n = toNumber(value);
    if (n !== null) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  return String(value);
}

/** Parse a NUMERIC/bigint string, or return null if it is not a number. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function compare(a: unknown, b: unknown, numeric: boolean): number {
  if (numeric) {
    const na = toNumber(a);
    const nb = toNumber(b);
    // A blank sorts last in ascending order rather than as zero, which is
    // what Number(null) would give.
    if (na === null && nb === null) return 0;
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  }

  // Missing values sort after present ones, in either direction.
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}
