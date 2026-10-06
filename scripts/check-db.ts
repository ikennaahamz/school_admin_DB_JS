/**
 * Can Node reach the configured database at all?
 *
 *     npm run check:db          # whatever DB_TARGET selects
 *     npm run check:db:cloud    # force the cloud database
 *
 * Reports whether the connection is reachable, what it is running, and
 * whether the schema is present. Passwords and other secrets are never
 * included in the output.
 *
 * Why this exists as a standalone script
 * -------------------------------------
 * This is the Node counterpart of `scripts/test_neon.py` in the Python
 * project, and it exists for the same reason: the deployed build can fail
 * on connectivity alone, and "it cannot connect" is not an actionable
 * diagnosis.
 *
 * It deliberately makes ONE connection with the plain `pg` client. Every
 * other failure mode is layered on top of that -- the connection pool, the
 * transaction wrapper, the actor setting, Vitest's worker processes -- and
 * each one can turn a working credential into an indistinguishable
 * timeout. So when connectivity is in question, strip it back to the
 * driver and the socket first.
 *
 * It tries the pooled DSN and then the direct one, because the pooler sits
 * in front of the same database and a fault in one is not a fault in the
 * other.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

import { dsnFingerprint, normaliseDsn, redact, resolveDsn } from "@/lib/db";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LOG_DIR = path.join(ROOT, ".logs");

/**
 * Print and keep a copy.
 *
 * The log exists because this script is the thing you run when something
 * is already going wrong, which is exactly when a terminal scrollback is
 * least useful -- it scrolls away, it is cleared, or it was never the window
 * you were looking at. Writing it to a file means the result can be read
 * back later without asking anyone to retype it, and re-running overwrites
 * it rather than accumulating.
 */
const transcript: string[] = [];

function say(line = ""): void {
  transcript.push(line);
  console.log(line);
}

function writeLog(name: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(path.join(LOG_DIR, `${name}-${stamp}.log`), transcript.join("\n") + "\n", "utf8");
  } catch (err) {
    // Never let logging be the reason a diagnostic fails.
    console.error(`(could not write log file: ${(err as Error).message})`);
  }
}

/**
 * Load .env into process.env without overriding anything already set.
 *
 * `lib/db.ts` reads process.env and nothing else, so the values have to be
 * there before `resolveDsn()` is called. `--env-file` would do it, but it
 * is easy to forget on a script whose whole job is diagnosing connection
 * problems, and a silently empty environment here produces a misleading
 * "DATABASE_URL is not set" rather than an obvious mistake.
 */
function loadEnvIntoProcess(): void {
  let text: string;
  try {
    text = readFileSync(path.join(ROOT, ".env"), "utf8");
  } catch {
    say("(no .env found; using the ambient environment)");
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadEnvIntoProcess();

async function attempt(label: string, dsn: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const started = Date.now();
  const client = new Client({ connectionString: dsn, connectionTimeoutMillis: 15_000, ...extra });

  say(`\n--- ${label} ---`);
  say(`  target : ${dsnFingerprint(dsn)}`);

  try {
    await client.connect();
    say(`  socket : connected in ${Date.now() - started} ms`);

    const version = await client.query("SELECT version() AS v");
    const full = String(version.rows[0].v);
    say(`  server : ${full.split(" on ")[0]}`);
    // version() renders as "<product> (<build>) on <platform>, <compiler>".
    // The platform is the bit worth recording in a report, and it moved:
    // Neon now serves aarch64 while a local install is usually x86_64.
    const platform = full.split(" on ")[1]?.split(",")[0]?.trim();
    say(`  arch   : ${platform ?? "not reported by this build"}`);

    const schema = await client.query(
      "SELECT count(*)::text AS n FROM information_schema.tables " +
        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const tables = Number(schema.rows[0].n);

    if (tables === 0) {
      say("  schema : ABSENT -- this database has no tables. Run `npm run apply:migrations`.");
      return true;
    }

    const counts = await client.query(
      "SELECT (SELECT count(*) FROM users)::text   AS users, " +
        "(SELECT count(*) FROM students)::text AS students, " +
        "(SELECT count(*) FROM enrollments)::text AS enrolments",
    );
    const row = counts.rows[0] as Record<string, string>;
    say(`  schema : ${tables} tables present`);
    say(`  seed   : users=${row.users} students=${row.students} enrolments=${row.enrolments}`);

    const procedures = await client.query(
      "SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
        "WHERE n.nspname = 'public'",
    );
    say(`  plpgsql: ${procedures.rows[0].n} functions/procedures`);

    return true;
  } catch (err) {
    const detail = redact(String((err as Error).message ?? err).trim().split("\n")[0]);
    say(`  FAILED after ${Date.now() - started} ms`);
    say(`  reason : ${detail}`);
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const target = (process.env.DB_TARGET ?? "cloud").trim().toLowerCase();

  say("=".repeat(68));
  say("Node.js reachability check for the configured database");
  say("=".repeat(68));
  say(`node      : ${process.version} on ${process.platform} ${process.arch}`);
  say(`pg        : ${(await import("pg/package.json", { with: { type: "json" } })).default.version}`);
  say(`DB_TARGET : ${target}  -> ${target === "local" ? "LOCAL_DATABASE_URL" : "DATABASE_URL"}`);

  // The value the application itself would resolve, through the same code
  // path, so a mismatch between this and the application cannot hide.
  let selected: string;
  try {
    selected = resolveDsn();
    say(`resolves  : ${dsnFingerprint(selected)}`);
  } catch (err) {
    say(`resolves  : FAILED -- ${redact((err as Error).message)}`);
    return 1;
  }

let ok = await attempt("selected DSN", selected);

// Second hypothesis, and the one that explains a psql-works/Node-fails
// split. DNS for this host returns AAAA records alongside the A records,
// and Node's Happy Eyeballs selection can settle on an IPv6 address that
// this machine has a route for but no working path through -- libpq makes
// a different choice, which is why psql may succeed where pg does not.
// Forcing IPv4 isolates that without changing any configuration.
if (!ok) {
  ok = await attempt("selected DSN, IPv4 forced", selected, { family: 4 });
}

// Third: the pooler is separate infrastructure in front of the same data,
// so a fault in it is not a fault in the database.
const direct = process.env.DATABASE_URL_UNPOOLED;
if (!ok && direct) {
  const dsn = normaliseDsn(direct);
  ok = await attempt("direct DSN (pooler bypassed)", dsn);
  if (!ok) {
    ok = await attempt("direct DSN, IPv4 forced", dsn, { family: 4 });
  }
}

  say(`\n${"=".repeat(68)}`);
  if (ok) {
    say("Reachable. If the application still fails, the fault is not the network.");
  } else {
    say("Not reachable from this process.");
    say("Compare with `psql`: if psql reaches the same DSN but this does not,");
    say("the difference is the driver or the network path, not the credential.");
  }
  say("=".repeat(68));

  writeLog(`check-db-${target}`);

  return ok ? 0 : 1;
}

main().then((code) => {
  // Pick the newest transcript by modification time, not by sorting the
  // filenames. Sorting names and taking the last one reported the *local*
  // log after a *cloud* run, because "check-db-local-..." sorts after
  // "check-db-cloud-..." -- which is how a cloud diagnostic ends up
  // pointing the reader at a stale local result.
  let latest: string | undefined;
  let newest = -Infinity;
  for (const file of readdirSync(LOG_DIR)) {
    if (!file.startsWith("check-db-")) continue;
    const modified = statSync(path.join(LOG_DIR, file)).mtimeMs;
    if (modified > newest) {
      newest = modified;
      latest = file;
    }
  }
  if (latest) console.log(`\n(transcript saved to .logs/${latest})`);
  process.exit(code);
});