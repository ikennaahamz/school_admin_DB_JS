/**
 * Database connection layer for the School Administration System.
 *
 * Every SQL statement in the application goes through this module, so
 * connection handling, error translation and the actor context live in
 * exactly one place.
 *
 * Connection model
 * ----------------
 * The Python original opened a short-lived psycopg2 connection per
 * operation, because psycopg2 connections are not thread-safe and
 * Streamlit reruns the whole script on every interaction. This rewrite
 * is a Next.js server, which is long-lived and concurrent, so it uses a
 * single `pg.Pool` instead. The pool is cached on `globalThis` so
 * Next.js hot reloads in development do not leak a new pool per edit.
 *
 * That change is what makes the actor setting subtle, so it is spelled
 * out here rather than left to be rediscovered:
 *
 *   The `app.user` setting is written TRANSACTION-SCOPED (`is_local =
 *   true`) and every statement that carries an actor runs inside an
 *   explicit transaction. Postgres discards the setting at COMMIT or
 *   ROLLBACK, so a recycled pooled connection can never carry one
 *   request's actor into the next request's `grade_audit` row.
 *
 *   The Python version wrote it SESSION-SCOPED (`false`) and was safe
 *   only because the connection was closed immediately afterwards.
 *   Ported verbatim onto a pool, that same line would silently record
 *   the previous request's actor for the person who entered a grade.
 *
 * Which database is used is chosen by the `DB_TARGET` setting.
 * `local` selects LOCAL_DATABASE_URL for development; anything else,
 * including the default, means the cloud database named by
 * DATABASE_URL. The project was developed against Supabase and moved to
 * Neon because Supabase's free tier publishes IPv6-only hostnames that
 * an IPv4-only client cannot reach.
 *
 * The brief asks for the database connection code to be shown in the
 * report; this file is that code.
 */

import { createHash } from "node:crypto";
import { Pool, types } from "pg";

/**
 * DATE (OID 1082) is returned as the raw 'YYYY-MM-DD' string rather than
 * a JS Date.
 *
 * node-postgres otherwise parses it to local midnight, which renders as
 * the previous day for any viewer west of UTC. A school administration
 * system that shows a student's date of birth off by one is worse than
 * one that shows the string. NUMERIC (OID 1700) is already returned as
 * a string by default and is left alone — see the sorting note in
 * components/DataTable.tsx, which compares it numerically.
 */
types.setTypeParser(types.builtins.DATE, (value: string) => value);

/** Raised for failures the UI should show the user as a message. */
export class DatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DatabaseError";
  }
}

function setting(key: string, defaultValue?: string): string | undefined {
  // The Python original consulted three sources -- st.secrets, the
  // environment, then .env -- because Streamlit Community Cloud injects
  // deployment secrets into st.secrets and reading only os.getenv was a
  // real deployment bug. Vercel injects into process.env for both local
  // development and deployed builds, so the three sources collapse to
  // one and the secrets branch has no reason to exist.
  const value = process.env[key];
  return value === undefined || value === "" ? defaultValue : value;
}

/** Which database the app talks to. */
export function dbTarget(): string {
  // `local` selects LOCAL_DATABASE_URL. Any other value means the cloud
  // database. Compared case-insensitively because the default used to be
  // the literal string "supabase", retained as an accepted alias but no
  // longer meaningful.
  return (setting("DB_TARGET", "cloud") ?? "cloud").trim().toLowerCase();
}

/**
 * Repair the paste defects that survive a trip through a secrets panel.
 *
 * A connection string that a human copies by hand picks up debris that
 * no amount of care at the source prevents: surrounding whitespace, the
 * `DATABASE_URL=` key when the whole `.env` line is pasted into the
 * value, quotes carried over from either file format, or the tail of a
 * `[section]` header. None of these are so much the user's mistake as
 * an artefact of the tooling, and each produces a baffling error -- a
 * stray bracket becomes "password authentication failed", which points
 * straight at the credential and away from the real cause.
 *
 * The repair is one rule: a PostgreSQL DSN always begins with its
 * scheme, so everything before the first occurrence of a scheme is
 * debris and is discarded. Surrounding quotes, brackets and whitespace
 * are then trimmed. A well-formed DSN passes through byte-for-byte,
 * which is what makes this safe to apply unconditionally.
 *
 * Verified by tests/config.test.ts.
 *
 * This deliberately does not attempt to repair a wrong password. No
 * amount of string tidying recovers a character that was never copied,
 * and guessing at one would be dishonest. `dsnFingerprint()` exists to
 * make that case obvious instead of mysterious.
 */
export function normaliseDsn(dsn: string): string {
  let value = dsn.trim();

  // Quotes inherited from .env or .toml syntax, when they wrap the whole
  // value. Done before the scheme is located, so that
  // DATABASE_URL="postgres://..." loses both the key and the quotes.
  if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
    value = value.slice(1, -1).trim();
  }

  let start = -1;
  for (const scheme of ["postgresql://", "postgres://"]) {
    const found = value.indexOf(scheme);
    if (found > start) start = found;
  }
  if (start > 0) value = value.slice(start);

  // Trailing debris left by the slice above, or pasted on its own.
  return value.trim().replace(/["' \t\r\n\]]+$/, "").trim();
}

/**
 * Describe a DSN precisely enough to compare, and safely enough to print.
 *
 * This exists because "password authentication failed" is the least
 * informative error PostgreSQL emits: it is identical whether the
 * password is wrong, truncated, stale after a rotation, or belongs to a
 * different branch, and it says nothing about which. When a deployment
 * fails from a machine nobody can inspect, the only way to settle it is
 * to compare what the deployed process actually holds against what is
 * known to work.
 *
 * So this prints the connection target in full -- host, port, database,
 * user, query parameters -- plus the length and an eight-character
 * SHA-256 prefix of the password. That is enough to prove two strings
 * are identical or to name the difference between them, and it does not
 * disclose the secret: recovering a 16-character credential from a
 * truncated digest of it is not feasible.
 *
 * Never print the DSN itself. libpq does exactly that when it rejects a
 * malformed connection string, so driver error text is redacted before
 * it reaches a log or the screen.
 */
export function dsnFingerprint(dsn: string): string {
  let parsed: URL;
  try {
    parsed = new URL(normaliseDsn(dsn));
  } catch (err) {
    return `unparseable (${(err as Error).message})`;
  }

  const password = decodeURIComponent(parsed.password || "");
  const digest = password ? createHash("sha256").update(password, "utf8").digest("hex").slice(0, 8) : "";
  const port = parsed.port || "5432";
  const database = parsed.pathname.replace(/^\//, "") || "(default)";

  const parts = [
    `host=${parsed.hostname}`,
    `port=${port}`,
    `db=${database}`,
    `user=${decodeURIComponent(parsed.username) || "(none)"}`,
    `passlen=${password.length}`,
    `sha256=${digest || "(empty)"}`,
  ];
  if (parsed.search) {
    const params = [...parsed.searchParams.entries()].map(([k, v]) => `${k}=${v}`).join("&");
    parts.push(`query=${params}`);
  }
  if (password) parts.push("credentials=redacted");
  return parts.join(" ");
}

/**
 * Resolve the DSN, failing loudly with an actionable message.
 *
 * Exported so scripts/ and tests resolve the DSN through the same code
 * path the application does, rather than reimplementing the selection
 * and drifting from it.
 */
export function resolveDsn(): string {
  if (dbTarget() === "local") {
    const dsn = setting("LOCAL_DATABASE_URL");
    if (!dsn) {
      throw new DatabaseError(
        "DB_TARGET is 'local' but LOCAL_DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
      );
    }
    return normaliseDsn(dsn);
  }

  const dsn = setting("DATABASE_URL");
  if (!dsn) {
    throw new DatabaseError(
      "DATABASE_URL is not set. Add it as an environment variable in your deployment " +
        "settings (Project -> Settings -> Environment Variables on Vercel). Locally, " +
        "copy .env.example to .env and paste the connection string from your provider's " +
        "dashboard.",
    );
  }
  return normaliseDsn(dsn);
}

/**
 * Strip credentials out of driver error text.
 *
 * libpq quotes the offending password back inside its own error message
 * when it refuses a malformed connection string::
 *
 *     invalid dsn: unexpected spaces found in "<the password>"
 *
 * so a database error is not automatically safe to log or display. Two
 * passes: credentials sitting in a URI, then any bare `npg_` token that
 * escaped unquoted.
 */
export function redact(message: string): string {
  return message
    .replace(/(:\/\/[^:@\s/]*:)([^@\s]*)@/g, "$1<redacted>@")
    .replace(/\bnpg_[A-Za-z0-9]+/g, "npg_<redacted>");
}

function friendlyError(err: unknown): string {
  // The raw SQLSTATE is kept because it is the evidence an instructor
  // wants to see next to the rule that was enforced.
  const code = (err as { code?: string } | null)?.code;
  const message = redact(String((err as Error)?.message ?? err).trim().split("\n")[0]);

  switch (code) {
    case "23505":
      return `Duplicate value — ${message} (SQLSTATE 23505: unique_violation)`;
    case "23503":
      return `Related record missing or still in use — ${message} (SQLSTATE 23503: foreign_key_violation)`;
    case "23514":
      return `Value rejected by a CHECK constraint — ${message} (SQLSTATE 23514: check_violation)`;
    case "P0001":
      // RAISE EXCEPTION from our own PL/pgSQL code.
      return message;
    default:
      return `Database error — ${message} (SQLSTATE ${code ?? "unknown"})`;
  }
}

/**
 * The pool, created lazily.
 *
 * Lazy because `next build` imports every module to collect page data,
 * and an eager `new Pool()` plus a connection probe would make the build
 * fail whenever DATABASE_URL is absent, which is the normal state of a
 * fresh clone and of CI.
 */
const globalForDb = globalThis as unknown as { __schoolAdminPool?: Pool };

function pool(): Pool {
  if (!globalForDb.__schoolAdminPool) {
    const dsn = resolveDsn();
    globalForDb.__schoolAdminPool = new Pool({
      connectionString: dsn,
      // Deliberately small.
      //
      // The Python original opened one connection per operation and leaned
      // on the provider's pooler. A Next.js server is long-lived and
      // concurrent, so this process holds a real pool -- and on a free-tier
      // managed Postgres the ceiling is low enough that a large pool is not
      // free headroom, it is a way to be disconnected. Overridable with
      // DB_POOL_MAX for a paid tier.
      max: Number(process.env.DB_POOL_MAX ?? 5),
      // Generous, because the managed Postgres this points at scales to
      // zero after five minutes of inactivity and the setting cannot be
      // turned off below the paid plan. A cold request arrives while the
      // database is still resuming, which routinely takes longer than the
      // previous 10 s, so a short timeout turned a working deployment into
      // "Could not connect to the database" precisely when somebody first
      // visited it.
      //
      // The trade is that a genuinely unreachable host now takes this long
      // to report. `scripts/check-db.ts` uses a 15 s timeout of its own, so
      // diagnostics stay quick.
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 45_000),
      idleTimeoutMillis: 30_000,
    });

    // An idle client can be dropped by the provider at any time. Without
    // this listener that surfaces as an unhandled 'error' event and takes
    // the process down instead of failing the next query.
    globalForDb.__schoolAdminPool.on("error", (err) => {
      console.error("Unexpected error on an idle database client:", redact(err.message));
    });

    // Clear any session-level `app.user` on every freshly opened backend.
    //
    // Transaction-scoping the setting is not by itself sufficient. The
    // provider's pooler keeps server sessions alive and reuses them
    // between clients, and `current_setting('app.user', TRUE)` falls back
    // to whatever session value is already there. So a single
    // session-scoped `set_config('app.user', ...)` from any other process
    // -- an older deploy of this app, the Python original, or a psql
    // session on the same branch -- would sit on that backend and be
    // picked up by `trg_audit_grade_change` in place of CURRENT_USER.
    //
    // One statement per new connection, outside our transactions, is
    // cheap and removes the vector entirely.
    globalForDb.__schoolAdminPool.on("connect", (client) => {
      void client.query("SELECT set_config('app.user', $1, false)", [""]).catch((err: Error) => {
        console.error("Could not reset app.user on a new connection:", redact(err.message));
      });
    });
  }
  return globalForDb.__schoolAdminPool;
}

/**
 * Run `work` against one pooled connection inside a transaction, with
 * `actor` visible to the `trg_audit_grade_change` trigger as
 * `current_setting('app.user', TRUE)`.
 *
 * `set_config(..., true)` is transaction-local, so PostgreSQL resets the
 * setting when this transaction ends however it ends. That is the whole
 * point: a connection returned to the pool carries no actor.
 */
async function withActor<T>(actor: string | undefined, work: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  let client: import("pg").PoolClient;
  try {
    client = await pool().connect();
  } catch (err) {
    const detail = redact(String((err as Error)?.message ?? err).trim());
    throw new DatabaseError(
      `Could not connect to the database.\n\n` +
        `Connection target: ${dsnFingerprint(resolveDsn())}\n\n` +
        `Technical detail: ${detail}\n\n` +
        `If the deployed app reports this while the same value works locally, the secret ` +
        `in the deployment differs from the one that works. Compare the fingerprint ` +
        `above against 'npm run dsn-fingerprint'; every field, including the sha256, ` +
        `must match.`,
      { cause: err },
    );
  }

  // True once the connection is back in a known state -- committed, or
  // rolled back -- and so is safe to hand to the next borrower.
  let reusable = false;
  try {
    await client.query("BEGIN");
    if (actor) {
      // set_config() takes a plain string, so the value is bound as a
      // parameter rather than interpolated — an actor name is
      // user-controlled input.
      await client.query("SELECT set_config('app.user', $1, true)", [String(actor)]);
    }
    const result = await work(client);
    await client.query("COMMIT");
    reusable = true;
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
      reusable = true;
    } catch {
      // The connection itself is broken, so it stays unreusable and is
      // destroyed below. Rethrowing here would mask the original error.
    }
    throw err instanceof DatabaseError ? err : new DatabaseError(friendlyError(err), { cause: err });
  } finally {
    // An unreusable connection is destroyed rather than returned to the
    // pool. `release()` on its own hands the socket back without
    // unwinding session state, so a client abandoned mid-transaction
    // would leave its transaction open for the next borrower to inherit —
    // including whatever `app.user` it set. That is the same leak this
    // module exists to prevent, arriving by a different route.
    //
    // A connection that rolled back cleanly is kept: an ordinary
    // constraint violation (23505, 23514) is routine here and must not
    // cost a socket.
    client.release(reusable ? undefined : true);
  }
}

/** Run a SELECT and return every row. */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
  actor?: string,
): Promise<T[]> {
  return withActor(actor, async (client) => {
    const result = await client.query(sql, params as unknown[]);
    return result.rows as T[];
  });
}

/** Run a SELECT expected to yield exactly one row. */
export async function queryOne<T = unknown>(
  sql: string,
  params: readonly unknown[] = [],
  actor?: string,
): Promise<T | null> {
  const rows = await query<Record<string, unknown>>(sql, params, actor);
  const row = rows[0];
  return row === undefined ? null : (Object.values(row)[0] as T);
}

/**
 * Run an INSERT/UPDATE/DELETE and return the affected row count.
 *
 * `returning` yields the inserted row when the caller needs the generated
 * primary key — for example after inserting a student so the app can
 * immediately create their user account.
 */
export async function exec(
  sql: string,
  params: readonly unknown[] = [],
  actor?: string,
  returning?: string,
): Promise<number | Record<string, unknown>> {
  return withActor(actor, async (client) => {
    const result = await client.query(sql, params as unknown[]);
    if (returning) return result.rows[0];
    return result.rowCount ?? 0;
  });
}

/**
 * CALL a PL/pgSQL procedure by name with positional arguments.
 *
 * The procedure name cannot be parameterised in CALL, so it is checked
 * against an allowlist rather than interpolated blindly.
 */
export async function callProcedure(name: string, args: readonly unknown[] = [], actor?: string): Promise<void> {
  // Keep in sync with db/migrations/*.sql: enroll_student is the only
  // procedure in the schema, so this list is complete.
  const allowed = new Set(["enroll_student"]);
  if (!allowed.has(name)) {
    throw new Error(`Procedure '${name}' is not on the allowlist.`);
  }

  const placeholders = Array.from({ length: args.length }, (_, i) => `$${i + 1}`).join(", ");
  const sql = `CALL ${name}(${placeholders})`;
  await withActor(actor, async (client) => {
    await client.query(sql, args as unknown[]);
  });
}

/**
 * Row count for a dashboard tile.
 *
 * `table` is checked against a fixed list because it cannot be
 * parameterised — identifiers cannot be bind values in SQL.
 */
export async function tableCount(table: string): Promise<number> {
  const allowed = new Set([
    "users",
    "departments",
    "instructors",
    "students",
    "course_sections",
    "enrollments",
    "assignments",
    "submissions",
    "attendance",
    "classrooms",
    "roles",
  ]);
  if (!allowed.has(table)) {
    throw new Error(`Table '${table}' is not on the allowlist.`);
  }
  const count = await queryOne<number | string>(`SELECT COUNT(*) FROM ${table}`);
  return Number(count ?? 0);
}

/** Connectivity check for the sidebar status indicator. */
export async function ping(): Promise<[boolean, string]> {
  try {
    const version = await queryOne<string>("SELECT version()");
    return [true, String(version).split(" on ")[0]];
  } catch (err) {
    return [false, err instanceof Error ? err.message : String(err)];
  }
}