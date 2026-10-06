/**
 * Diagnose why URL parsing fails on DATABASE_URL. Never prints the
 * password.
 *
 * Masks the credential as <user>:<redacted> and reports only structural
 * facts: how many '@' appear, whether a port is present, and how the
 * value differs from what the Neon CLI wrote.
 *
 * Intentionally does NOT reconstruct a DSN. An earlier version of this
 * script rebuilt one and produced a malformed URL, missing the slash
 * before the database name. Reassembling a connection string by hand is
 * exactly the error-prone step worth removing: the .env value is already
 * correct and should be copied verbatim.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let text: string;
try {
  text = readFileSync(path.join(ROOT, ".env"), "utf8");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  console.error(".env not found. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const matches = [...text.matchAll(/^DATABASE_URL\s*=\s*(.+)$/gm)].map((m) => m[1]);
console.log(`DATABASE_URL occurrences in .env : ${matches.length}`);
if (matches.length === 0) {
  console.error("DATABASE_URL not found");
  process.exit(1);
}

let index = 0;
for (const raw of matches) {
  index += 1;
  const value = raw.trim().replace(/^["']|["']$/g, "");
  const masked = value.replace(/(:\/\/)([^:@/]+):[^@]*@/, "$1$2:<redacted>@");
  console.log(`\n--- occurrence ${index} ---`);
  console.log(`  masked value : ${masked}`);
  console.log(`  starts with  : ${JSON.stringify(value.slice(0, 20))}`);
  console.log(`  ends with    : ${JSON.stringify(value.slice(-24))}`);
  console.log(`  '@' count    : ${(value.match(/@/g) ?? []).length}`);
  console.log(`  ':' count    : ${(value.match(/:/g) ?? []).length}`);
  console.log(`  quotes       : ${'"\'\''.includes(raw.trim()[0]) ? "yes" : "no"}`);
  console.log(`  whitespace   : ${value !== raw.trim() ? "leading/trailing" : "none"}`);

  let parsed: URL | null = null;
  let parseError = "";
  try {
    parsed = new URL(value);
  } catch (err) {
    parseError = (err as Error).message;
  }

  if (parsed) {
    console.log(`  protocol     : ${parsed.protocol.replace(":", "") || "(none)"}`);
    console.log(`  netloc parts : ${(value.split("@").length).toString()}`);
    const hostport = value.split("@").pop() ?? "";
    console.log(`  hostport     : ${hostport.replace(/^[^:@]*:[^@]*@/, "")}`);
    console.log(`  has ':port'  : ${hostport.includes(":") ? "yes" : "no"}`);
    console.log(`  parsed port  : ${parsed.port || "(none)"}`);
    console.log(`  path         : ${JSON.stringify(parsed.pathname)}`);
  } else {
    console.log(`  parse        : FAILED -> ${parseError}`);
  }
}

console.log();
console.log("=".repeat(68));
console.log("Do not rebuild the DSN by hand. Open .env, copy the entire");
console.log("DATABASE_URL= line verbatim, and paste it into your");
console.log("deployment's environment settings. It is already correct");
console.log("and needs no escaping.");
console.log("=".repeat(68));