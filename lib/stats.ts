/**
 * Numeric summaries for report tables.
 *
 * `reports_screen` called `frame.select_dtypes("number").describe()` on the
 * report result and printed it under "Summary statistics".
 *
 * That call does not port as-is, and the reason is handoff §7b. In Python,
 * psycopg2 returned NUMERIC as `decimal.Decimal` and `db._coerce()` turned
 * it into a float, so pandas saw a numeric dtype and `select_dtypes`
 * matched the column. node-postgres returns NUMERIC -- and bigint -- as
 * *strings*, so there is no numeric dtype to select and the pandas call
 * would return an empty frame.
 *
 * So the columns have to be identified by inspecting the values, which is
 * what `numericColumns` does: a column is numeric when every non-blank
 * value parses as a finite number. That is a genuine inference from the
 * data rather than a type the driver promised, so it is deliberately
 * strict -- one non-numeric value means the column is text.
 */

export type Stat = { key: string; count: number; mean: number; min: number; max: number; sum: number };

/** Column keys whose values all parse as numbers. */
export function numericColumns(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).filter((key) => rows.every((row) => isNumericish(row[key])));
}

function isNumericish(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true; // blank is not evidence
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "bigint") return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return true;
  return Number.isFinite(Number(trimmed));
}

function numbers(rows: Record<string, unknown>[], key: string): number[] {
  return rows
    .map((row) => row[key])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => (typeof value === "number" ? value : Number(String(value))))
    .filter((n) => Number.isFinite(n));
}

/** count / mean / min / max / sum for each numeric column, plus its spread. */
export function describeColumns(rows: Record<string, unknown>[]): Stat[] {
  return numericColumns(rows).map((key) => {
    const values = numbers(rows, key);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = values.length === 0 ? Number.NaN : sum / values.length;
    const variance =
      values.length < 2 ? Number.NaN : values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);

    return {
      key,
      count: values.length,
      mean,
      min: values.length === 0 ? Number.NaN : Math.min(...values),
      max: values.length === 0 ? Number.NaN : Math.max(...values),
      sum,
      // Sample standard deviation, matching pandas' describe().
      stdev: Math.sqrt(variance),
    };
  });
}

export type StatWithSpread = Stat & { stdev: number };
