import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Signs in once per role and saves the resulting cookie state.
 *
 * Why this exists
 * ---------------
 * bcryptjs is a pure-JavaScript implementation, and a cost-12 verify takes
 * roughly 600 ms of *CPU*. It therefore blocks the Node event loop of the
 * very process serving the request -- it is not I/O, so it cannot be
 * interleaved with anything. With Playwright's default worker count, forty
 * tests each signing in put forty blocked event loops' worth of work
 * through one dev server, and logins appeared to hang.
 *
 * That is not only a test problem. It is a real property of the deployed
 * application: concurrent sign-ins on a single server instance serialise,
 * because the hash is CPU-bound and single-threaded. Worth knowing before
 * choosing an instance size.
 *
 * Signing in once per role and reusing the cookie turns forty hashes into
 * four, which is both faster and far less flaky.
 */

export const ROLES = ["admin", "registrar", "i.kaya", "student1"] as const;
export type Role = (typeof ROLES)[number];

export const AUTH_DIR = path.join(".auth");

export function statePath(role: Role): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3100";
  mkdirSync(AUTH_DIR, { recursive: true });

  for (const role of ROLES) {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();

      await page.goto("/login");
      await page.locator("#username").fill(role);
      await page.locator("#password").fill("Passw0rd!");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

      await context.storageState({ path: statePath(role) });
    } finally {
      await browser.close();
    }
  }
}
