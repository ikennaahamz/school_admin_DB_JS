/**
 * Signed session cookie.
 *
 * This module has no counterpart in the Python application. Streamlit
 * kept sessions server-side in its own runtime, so `src/auth.py` never had
 * to think about them. A Next.js server is stateless, so the session has
 * to travel with the request.
 *
 * What is in the cookie
 * ---------------------
 * Only the user id, an issue time, an expiry, and an HMAC. Roles are
 * deliberately NOT stored.
 *
 * The tempting design is to embed the roles so the common path needs no
 * database round trip. It is the wrong trade here, for one concrete
 * reason: `requireRole()` reads `user.roles`, so a role baked into a cookie
 * stays in force until the cookie expires. An administrator who revokes
 * the `registrar` role has not actually revoked anything, and nothing in
 * the UI can tell them so. Re-reading the roles on each request costs one
 * indexed join and makes revocation immediate, which is the behaviour the
 * Streamlit version had for free.
 *
 * The cookie is signed, not encrypted. It contains no secret -- only a
 * user id the database already knows -- so signing is what matters, and it
 * keeps the cookie readable in a debugger during development.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { User, loadRoles } from "@/lib/auth";
import { query } from "@/lib/db";

export const SESSION_COOKIE = "session";

/**
 * Eight hours.
 *
 * Long enough to get through a working day of demonstrations, short enough
 * that a forgotten browser on a shared machine is not a standing risk.
 */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

type Payload = { userId: number; issuedAt: number; expiresAt: number };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    // Failing loudly beats falling back to something predictable. A
    // hard-coded default would make every deployment that forgot the
    // variable forgeable, and would fail silently rather than loudly.
    throw new Error(
      "SESSION_SECRET is not set. Generate one with `openssl rand -base64 32` " +
        "and add it to .env locally, or to the deployment's environment settings.",
    );
  }
  return value;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

/** Build the signed cookie value for a user id. */
export function createSessionValue(userId: number, now = Date.now()): string {
  const payload: Payload = {
    userId,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/**
 * Verify and decode a cookie value, or return null.
 *
 * Returns null for every failure mode -- bad shape, bad signature,
 * tampered payload, expiry -- because a caller has nothing useful to do
 * with the distinction, and reporting it would tell an attacker which part
 * they got right.
 */
export function readSessionValue(value: string | undefined, now = Date.now()): Payload | null {
  if (!value) return null;

  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = value.slice(0, dot);
  const provided = value.slice(dot + 1);

  let expected: string;
  try {
    expected = sign(body);
  } catch {
    // SESSION_SECRET missing or unusable. Treated as "no session" rather
    // than a hard failure so a misconfigured deployment does not leak a
    // stack trace to the login page.
    return null;
  }

  // Both sides are fixed-length base64url HMACs; the length check keeps
  // timingSafeEqual from throwing on a truncated cookie.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }

  if (typeof payload?.userId !== "number" || typeof payload?.expiresAt !== "number") return null;
  if (payload.expiresAt <= now) return null;

  return payload;
}

/** Cookie attributes, in one place so sign-in and sign-out cannot disagree. */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Write the session cookie. Call from a Server Action or Route Handler. */
export async function startSession(userId: number): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSessionValue(userId), cookieOptions());
}

/** Clear the session cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

/**
 * The signed-in user for this request, or null.
 *
 * Re-reads from the database rather than trusting the cookie, so a role
 * change or a deactivated account takes effect on the next request instead
 * of at the next sign-in. This is the per-request cost of the stateless
 * design, and it is the right cost to pay.
 */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const payload = readSessionValue(jar.get(SESSION_COOKIE)?.value);
  if (payload === null) return null;

  const rows = await query<{
    user_id: number;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    status: string;
  }>(
    `SELECT user_id, username, email, first_name, last_name, status
          FROM users
         WHERE user_id = $1`,
    [payload.userId],
  );

  const row = rows[0];
  // A session that survives the account being disabled must not keep
  // working. Streamlit's server-side session would have been dropped by
  // the same status change; a stateless cookie has to check for itself.
  if (!row || row.status !== "active") return null;

  return loadRoles(new User(row));
}
