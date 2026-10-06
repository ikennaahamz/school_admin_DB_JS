/**
 * Helper for the five functions that assemble a WHERE clause at runtime.
 *
 * Why this exists
 * ---------------
 * `list_students`, `list_sections`, `list_enrollments`, `list_assignments`
 * and `list_attendance` each take optional filters and build their WHERE
 * clause by appending to a list. In Python that was `' AND '.join(where)`
 * with `%s` markers and a parallel `params` list; psycopg2 numbered the
 * placeholders for us. node-postgres does not -- it takes `$1`, `$2`, ...
 * literally -- so something has to keep the numbering and the value list
 * in step. Doing that by hand in five places is how parameter-binding bugs
 * get written, and a binding bug here is an injection bug.
 *
 * The clauses are still written with `%s` in this module's callers, so the
 * SQL text stays byte-comparable with the Python original and with the
 * files under `port/sql/`. `add()` rewrites them to numbered placeholders.
 *
 * Only *values* are ever bound. Table and column names still cannot be,
 * because SQL does not allow it; the two places that need an identifier
 * (the procedure call and the table count) use explicit allowlists in
 * `lib/db.ts` instead.
 */
export class Conditions {
  private readonly parts: string[] = [];
  readonly params: unknown[] = [];

  /**
   * Append one condition.
   *
   * `clause` uses `%s` markers; supply one value per marker, in order.
   * Returns `this` so filters read as one statement.
   */
  add(clause: string, values: unknown[] = []): this {
    const first = this.params.length + 1;
    for (const value of values) this.params.push(value);

    let n = 0;
    this.parts.push(clause.replaceAll("%s", () => `$${first + n++}`));
    return this;
  }

  /** The finished condition, or TRUE when nothing was filtered on. */
  get clause(): string {
    return this.parts.length > 0 ? this.parts.join(" AND ") : "TRUE";
  }
}