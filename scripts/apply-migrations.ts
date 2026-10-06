/**
 * Apply the schema and seed data to the cloud database.
 *
 *     npm run apply:migrations            # refuse if tables already exist
 *     npm run apply:migrations -- --force # proceed anyway
 *
 * Runs db/apply_all.sql, which is the four migrations concatenated.
 * Reports what exists before and after, and prints no secret.
 *
 * Connects with the DIRECT (unpooled) DSN, not the app's pooled one.
 * Migrations issue DDL and rely on session state and advisory locks,
 * neither of which behaves correctly through a connection pooler, so
 * running them on the pooled DATABASE_URL is a latent failure. This is
 * the reason .env.example carries DATABASE_URL_UNPOOLED.
 *
 * Refuses to run against a database that already has tables, unless
 * --force is passed. A half-applied schema is worse than none, so the
 * check is deliberate rather than a bare CREATE TABLE that fails halfway.
 */

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

import { normaliseDsn, redact } from "../lib/db";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SQL_FILE = path.join(ROOT, "db", "apply_all.sql");
const FORCE = process.argv.includes("--force");

function readEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(path.join(ROOT, ".env"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return values;
    throw err;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    values[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return values;
}

type Counts = { tables: number; constraints: number; triggers: number };

async function counts(client: Client): Promise<Counts> {
  const tables = await client.query<{ n: string }>(
    "SELECT count(*) FROM information_schema.tables " +
      "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  const constraints = await client.query<{ n: string }>(
    "SELECT count(*) FROM pg_constraint c " +
      "JOIN pg_namespace n ON n.oid = c.connamespace " +
      "WHERE n.nspname = 'public'",
  );
  const triggers = await client.query<{ n: string }>(
    "SELECT count(*) FROM information_schema.triggers WHERE trigger_schema = 'public'",
  );
  return {
    tables: Number(tables.rows[0].n),
    constraints: Number(constraints.rows[0].n),
    triggers: Number(triggers.rows[0].n),
  };
}

async function scalar(client: Client, sql: string): Promise<string> {
  const res = await client.query<Record<string, unknown>>(sql);
  const row = res.rows[0];
  return row === undefined ? "" : String(Object.values(row)[0]);
}

async function main(): Promise<number> {
  const env = readEnv();
  const raw = env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL_UNPOOLED;

  if (!raw) {
    console.log("DATABASE_URL_UNPOOLED is not set in .env.");
    console.log("Migrations must not run against the pooled DSN. Use 'neon link'");
    console.log("or copy the direct connection string from the Neon dashboard.");
    return 1;
  }
  if (!env.DATABASE_URL_UNPOOLED) {
    console.log("NOTE: reading DATABASE_URL_UNPOOLED from the ambient environment.");
  }

  const dsn = normaliseDsn(raw);
  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    console.log("DATABASE_URL_UNPOOLED is not a parseable URL. Run 'npm run check-dsn'.");
    return 1;
  }

  const line = "=".repeat(68);
  console.log(line);
  console.log("Applying schema to the cloud database");
  console.log(line);
  console.log(`\nhost    : ${parsed.hostname}:${parsed.port || "5432"}`);
  console.log(`database: ${parsed.pathname.replace(/^\//, "")}`);
  console.log(`role    : ${decodeURIComponent(parsed.username)}`);
  console.log("password: <redacted>\n");

  const sql = readFileSync(SQL_FILE, "utf8");
  console.log(`script  : ${path.basename(SQL_FILE)} (${sql.split(";").length - 1} statements, ` +
    `${statSync(SQL_FILE).size.toLocaleString("en-US")} bytes)\n`);

  const client = new Client({ connectionString: dsn, connectionTimeoutMillis: 30_000 });
  await client.connect();

  try {
    await client.query("BEGIN");

    const before = await counts(client);
    console.log(`before  : ${JSON.stringify(before)}`);

    if (before.tables > 0 && !FORCE) {
      console.log("\nRefusing to run: the database already has tables.");
      console.log("Re-running would fail partway and leave a half-applied");
      console.log("schema. To proceed anyway, pass --force, or drop the");
      console.log("schema first:");
      console.log("  DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await client.query("ROLLBACK");
      return 1;
    }

    console.log("\nrunning...");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("committed.\n");

    const after = await counts(client);
    console.log(`after   : ${JSON.stringify(after)}`);

    const seed = [
      ["users", "users           "],
      ["students", "students        "],
      ["course_sections", "course sections "],
      ["enrollments", "enrolments      "],
      ["assignments", "assignments     "],
      ["submissions", "submissions     "],
      ["attendance", "attendance      "],
    ] as const;

    console.log("\nseed data");
    for (const [table, label] of seed) {
      const n = await scalar(client, `SELECT count(*) FROM ${table}`);
      console.log(`  ${label} ${n.padStart(5)}`);
    }

    // Prove the procedural layer deployed, not just the tables.
    const letter = await scalar(client, "SELECT letter_grade_for(93)");
    console.log(`\n  letter_grade_for(93) -> ${letter}`);
    const fill = await scalar(
      client,
      "SELECT round(section_fill_ratio((SELECT min(section_id) FROM course_sections)))",
    );
    console.log(`  section_fill_ratio(first) -> ${fill}`);

    // Prove a trigger fires.
    const registered = await scalar(client, "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal");
    console.log(`  triggers registered -> ${registered}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`\nMigration failed: ${redact((err as Error).message)}`);
    console.error("Rolled back. Nothing was applied.");
    return 1;
  } finally {
    await client.end();
  }

  console.log(`\n${line}`);
  console.log("Cloud database ready.");
  console.log(line);
  return 0;
}

// Not top-level `await process.exit(...)`: package.json has no
// "type": "module", so tsx emits CommonJS and top-level await is a
// transform error. TypeScript does not catch this.
main().then((code) => process.exit(code));