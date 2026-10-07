import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * Why `channel: "chrome"` rather than the bundled Chromium
 * --------------------------------------------------------
 * `npx playwright install chromium` cannot complete in this environment:
 * the browser download makes no progress at all, which is the same egress
 * restriction that blocks outbound database connections. Chrome and Edge
 * are already installed on the machine, and `channel: "chrome"` drives
 * the system browser instead of a downloaded one.
 *
 * The trade-off is that this depends on Chrome being present, so a machine
 * without it will fail to run the suite. On a normal workstation the
 * bundled browser is the better choice -- remove the `channel` line and run
 * `npx playwright install chromium`.
 *
 * The alternative to a browser at all
 * ----------------------------------
 * The Python original used streamlit.testing.v1.AppTest, which drives the
 * real app headlessly and is faster and far less flaky than a browser. It
 * has no equivalent, because Next.js has no in-process test harness: a page
 * is server-rendered behind an HTTP request. That is the §7f trade-off --
 * slower, and the reason the assertions here overlap deliberately with the
 * unit tests in `tests/nav.test.ts`.
 */

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  // Signs in once per role and reuses the cookie. See the note in
  // tests/e2e/global-setup.ts: bcryptjs blocks the event loop, so forty
  // logins in parallel make the server look hung.
  globalSetup: "./tests/e2e/global-setup.ts",
  // Screens run real queries; Neon round-trips are slow, so the budget is
  // generous by design rather than by accident.
  timeout: 60_000,
  // Generous because every assertion here loads a real screen against a real
  // database, and `next dev` compiles each route on first request. The
  // dashboard alone issues nine separate queries. 15 s was not enough on a
  // cold load and produced failures that looked like broken assertions.
  expect: { timeout: 30_000 },
  // The suite is entirely read-only -- the Python original asserted that
  // screens render, not that they write -- so there is no shared mutable
  // state between workers to serialise. Fully parallel.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Two, deliberately. Each worker drives a real browser against one server,
  // and a cost-12 bcrypt verify blocks that server's event loop for ~600 ms.
  // At three workers the suite was fast but the real sign-in tests in
  // login.spec.ts failed intermittently; at two it is both quicker than
  // serial and stable across consecutive runs.
  workers: process.env.CI ? 1 : 2,
  reporter: [["list"]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  ],

  webServer: {
    // A production build, not `next dev`.
    //
    // Dev compiles each route on first request and dev-only work competes
    // with the test run for CPU, which produced two failures out of 47 that
    // passed in isolation and looked like broken assertions. Testing what
    // would actually be deployed is both more honest and steadier.
    command: "npm run build && npx next start -p " + PORT,
    url: `http://localhost:${PORT}/login`,
    env: {
      // Headroom for the test server only.
      //
      // Every page render opens several queries, and one server process is
      // shared by every browser. At the production default of 5
      // connections, pool.connect() started hitting its 10 s timeout under
      // that load, which surfaced as an intermittent page failure in the
      // sign-in tests rather than as an obvious pool error. The
      // production default stays conservative; the test server does not
      // have to be.
      DB_POOL_MAX: "20",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
