/**
 * Print the fingerprint of the local DATABASE_URL, to compare against the
 * one the deployed app prints when it cannot connect.
 *
 *     npm run dsn-fingerprint
 *
 * Why
 * ---
 * The deployed build fails with::
 *
 *     password authentication failed for user 'neondb_owner'
 *
 * That error is identical whether the password is wrong, truncated, stale
 * after a rotation, or belongs to a different branch, so it cannot
 * distinguish between the possibilities on its own. Both sides can,
 * though: this prints a fingerprint of the credentials that are known to
 * work, and the application prints one of the credentials it is actually
 * holding. Same fingerprint means the same secret; any differing field
 * names the defect.
 *
 * A fingerprint shows the connection target in full -- host, port,
 * database, user, query parameters -- and reduces the password to its
 * length and an eight-character SHA-256 prefix. That is enough to prove
 * two passwords identical and useless for reconstructing one, so this is
 * safe to paste into a bug report. It imports `lib/db.ts` rather than
 * reimplementing the format, so the two cannot drift apart.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { dbTarget, dsnFingerprint, normaliseDsn, resolveDsn } from "../lib/db";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load .env into process.env before anything reads it, matching the
// Python original's explicit load_dotenv(). Existing variables win, so an
// already-exported DATABASE_URL is not silently replaced.
const envPath = path.join(ROOT, ".env");
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    console.log(`(no .env at ${envPath}; using the ambient environment)`);
  }
}

function main(): number {
  const line = "=".repeat(70);
  console.log(line);
  console.log("Fingerprints of the credentials configured on this machine");
  console.log(line);

  const target = dbTarget();
  const chosen = target === "local" ? "LOCAL_DATABASE_URL" : "DATABASE_URL";
  console.log(`DB_TARGET = '${target}'  -> the app will use ${chosen}`);
  console.log();

  // Read both explicitly. Which one the app selects depends on DB_TARGET,
  // but a mismatch between the two is worth seeing even when only one of
  // them is in use -- that mismatch is a common cause of a deployment
  // that "works locally" and fails in the cloud, because local runs
  // silently pick the other value.
  const targets: [string, string][] = [
    ["DATABASE_URL", "the cloud database (Neon)"],
    ["LOCAL_DATABASE_URL", "the local PostgreSQL instance"],
  ];

  let failures = 0;
  for (const [key, description] of targets) {
    const dsn = process.env[key];
    console.log(`--- ${key}  (${description}) ---`);
    if (!dsn) {
      console.log("  not set");
      console.log();
      continue;
    }
    try {
      console.log(`  ${dsnFingerprint(normaliseDsn(dsn))}`);
    } catch (err) {
      // Report, never crash: this script exists to diagnose, so it must
      // survive a value it cannot describe.
      failures += 1;
      console.log(`  could not be described: ${(err as Error).message}`);
    }
    console.log();
  }

  // The value the app would actually open right now, resolved through the
  // same function the application calls.
  try {
    const active = resolveDsn();
    console.log("--- the value the application will connect with now ---");
    console.log(`  ${dsnFingerprint(active)}`);
    console.log();
    console.log("If the deployed app prints a different fingerprint, that");
    console.log("difference is the fault. host/port/db/user identify a wrong");
    console.log("endpoint or branch; passlen and sha256 identify a wrong or");
    console.log("mangled password.");
  } catch (err) {
    failures += 1;
    console.log("--- the application cannot resolve a DSN ---");
    console.log(`  ${(err as Error).message}`);
  }

  console.log();
  console.log(line);
  return failures ? 1 : 0;
}

process.exit(main());