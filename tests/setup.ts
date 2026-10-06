/**
 * Load `.env` into `process.env` before any test reads configuration.
 *
 * Why this exists rather than relying on a CLI flag
 * --------------------------------------------------
 * `npm test` has to work on a fresh clone with no special invocation, and
 * `vitest run` does not read `.env` into `process.env` on its own -- Vite
 * exposes those values through `import.meta.env` instead, which is not
 * what `lib/db.ts` reads. Passing `--env-file=.env` through `tsx` did
 * work, but only if it was remembered, and it is invisible in the failure
 * it causes: `DB_TARGET` silently resolves to its default of "cloud", so
 * the suite runs against the cloud database instead of the local one and
 * fails on connectivity with nothing pointing at the real cause.
 *
 * `process.loadEnvFile` is built into Node 20.12+ / 22, so this costs no
 * dependency. It is wrapped because the file is legitimately absent in CI
 * and on a fresh clone, and a missing `.env` should surface as a clear
 * "DATABASE_URL is not set" from the application rather than as a crash
 * in the test bootstrap.
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(import.meta.dirname, "..", ".env");

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
