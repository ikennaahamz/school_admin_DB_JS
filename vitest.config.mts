import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Every assertion here round-trips to Neon over the network. The
    // grade trigger also recomputes a student GPA per write, so a single
    // test can legitimately need several seconds. The default 5s produced
    // failures that looked like logic errors but were latency.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Loads .env into process.env -- see the note in tests/setup.ts.
    setupFiles: ["tests/setup.ts"],
    // Database test files run one at a time, on purpose.
    //
    // Vitest gives each test FILE its own worker process, and each worker
    // therefore builds its own `pg.Pool`. Five files in parallel meant five
    // pools opening at once -- 50 concurrent connections against a
    // free-tier managed Postgres, which is enough to trip connection
    // protection and turn into uniform timeouts that look like a bad
    // credential. Serialising costs about eight seconds locally and removes
    // the whole failure mode.
    fileParallelism: false,
    // Playwright specs live in tests/e2e/*.spec.ts and are driven by
    // @playwright/test, not Vitest, so the include pattern above must
    // not pick them up.
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
});