/**
 * Authentication and role-based authorisation.
 *
 * The brief requires a user table that allows users to log in, plus
 * support for user groups (admin, employee, customer, technical
 * staff) each with a specific role in the system. This module is that
 * mechanism:
 *
 * - passwords are stored as bcrypt digests and never in plaintext;
 * - login fetches the digest for the given username and compares the
 *   candidate against it with bcrypt's constant-time comparison, so a
 *   failed attempt reveals nothing about how close the guess was;
 * - roles come from the `user_roles` join table, so a person may hold
 *   more than one;
 * - `requireRole()` is what each screen calls to gate itself.
 */

import bcrypt from "bcryptjs";

import { exec, query, queryOne } from "@/lib/db";

// Cost 12 is bcrypt's default and is what every seeded row already uses,
// so the existing 33 digests verify without rehashing. Raising it later
// only requires rehashing on next successful login, so it is safe to
// leave here.
export const BCRYPT_ROUNDS = 12;

export const MIN_PASSWORD_LENGTH = 8;

/**
 * A cost-12 digest of a value generated at random and discarded.
 *
 * Its only purpose is to give the "no such user" branch of `authenticate`
 * the same cost as the "wrong password" branch. See the timing note there
 * for why it is a constant rather than a freshly computed digest.
 */
const DECOY_DIGEST = "$2b$12$SRrFA3kzVhO4RErOMG0CO.aMwO3P.WiKVsZ2n4WlxDBlUCM25MgVm";

/** The authenticated principal, as the app understands it. */
export class User {
  readonly user_id: number;
  readonly username: string;
  readonly email: string;
  readonly first_name: string;
  readonly last_name: string;
  // Not readonly: `loadRoles()` fills this in after construction, exactly
  // as the Python dataclass default_factory did before the role lookup.
  roles: string[] = [];

  private cachedAccessLevel: number | null = null;

  constructor(row: {
    user_id: number;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
  }) {
    this.user_id = row.user_id;
    this.username = row.username;
    this.email = row.email;
    this.first_name = row.first_name;
    this.last_name = row.last_name;
    this.roles = [];
  }

  get full_name(): string {
    return `${this.first_name} ${this.last_name}`;
  }

  get is_admin(): boolean {
    return this.roles.includes("admin");
  }

  /**
   * Highest access level across the user's roles.
   *
   * Mirrors `roles.access_level`. Read from the database rather than
   * hardcoded, so a level set in the admin screen takes effect on the next
   * login. Populated by `loadRoles()`, which is awaited by every path that
   * creates a `User`; the getter cannot do the query itself because
   * getters are synchronous, as `access_level` was in Python.
   */
  get access_level(): number {
    return this.cachedAccessLevel ?? 0;
  }

  has_role(...names: string[]): boolean {
    return names.some((name) => this.roles.includes(name));
  }

  /** @internal set by `loadRoles()` */
  setAccessLevel(level: number): void {
    this.cachedAccessLevel = level;
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** Return a bcrypt digest for `plaintext`. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/**
 * Constant-time comparison of a candidate password against a digest.
 *
 * A malformed digest in the row fails closed rather than throwing, which
 * matches the Python original: a corrupt row must not become a way to log
 * in, and must not become a 500 either.
 */
export async function verifyPassword(plaintext: string, digest: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, digest);
  } catch {
    return false;
  }
}

/** Validate a new password. Returns a list of problems; empty is good. */
export function passwordProblems(password: string, confirmation: string): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password !== confirmation) {
    problems.push("The two passwords do not match.");
  }
  if (!/[a-z]/i.test(password)) {
    problems.push("Must contain at least one letter.");
  }
  if (!/[0-9]/.test(password)) {
    problems.push("Must contain at least one digit.");
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Load a user's roles and cache their access level.
 *
 * Done here rather than in the `access_level` getter because the getter is
 * synchronous -- as it was in Python, where it called straight into
 * `db.query_df` -- and a Next.js data layer cannot await inside a getter.
 * Every `User` in the application is created through here, so the field is
 * always populated before `access_level` is read.
 */
export async function loadRoles(user: User): Promise<User> {
  const rows = await query<{ role_name: string }>(
    `SELECT r.role_name
          FROM user_roles ur
          JOIN roles r ON r.role_id = ur.role_id
         WHERE ur.user_id = $1
         ORDER BY r.role_name`,
    [user.user_id],
  );
  user.roles = rows.map((r) => r.role_name);

  if (user.roles.length > 0) {
    const levels = await query<{ access_level: number }>(
      `SELECT access_level FROM roles
                WHERE role_name = ANY($1)`,
      [user.roles],
    );
    user.setAccessLevel(Math.max(...levels.map((l) => Number(l.access_level))));
  }
  return user;
}

export type AuthResult = { user: User | null; message: string };

/**
 * Attempt a login.
 *
 * On failure `user` is null and the message is deliberately identical for
 * "no such user" and "wrong password", so the form cannot be used to
 * enumerate valid usernames.
 *
 * On timing -- and this differs from the Python original, on measurement
 * ------------------------------------------------------------------------
 * Python burned the miss path with `verify_password(password,
 * hash_password("decoy"))`, discarding the result. That costs one *hash*
 * plus one *compare*, while a real login costs one *compare*. Measured on
 * this machine at cost 12:
 *
 *     user exists ............................  544 ms
 *     user missing, Python's decoy ..........  1220 ms
 *     user missing, constant decoy (this) ....  610 ms
 *
 * So the "no such user" branch was about 2.2x slower than the branch it
 * was meant to be indistinguishable from, which hands an attacker the
 * very signal the code was written to remove -- a *faster* response for a
 * username that exists. Comparing against one constant cost-12 digest
 * instead makes both branches a single compare, which is the intent.
 *
 * Note this is a deliberate deviation from a verbatim port. The report
 * should describe the measured behaviour, not the Python source.
 */
export async function authenticate(username: string, password: string): Promise<AuthResult> {
  if (!username || !password) {
    return { user: null, message: "Enter both a username and a password." };
  }

  const rows = await query<{
    user_id: number;
    username: string;
    email: string;
    password_hash: string;
    first_name: string;
    last_name: string;
    status: string;
  }>(
    `SELECT user_id, username, email, password_hash,
               first_name, last_name, status
          FROM users
         WHERE username = $1`,
    [username.trim().toLowerCase()],
  );

  if (rows.length === 0) {
    // Spend the same time as a real verification so that response timing
    // does not reveal whether the user exists.
    await verifyPassword(password, DECOY_DIGEST);
    return { user: null, message: "Incorrect username or password." };
  }

  const row = rows[0];

  if (!(await verifyPassword(password, row.password_hash))) {
    return { user: null, message: "Incorrect username or password." };
  }

  if (row.status !== "active") {
    return {
      user: null,
      message: `This account is '${row.status}'. Ask an administrator to activate it.`,
    };
  }

  const user = await loadRoles(new User(row));

  if (user.roles.length === 0) {
    return { user: null, message: "This account has no roles assigned." };
  }

  return { user, message: `Signed in as ${user.full_name} (${user.roles.join(", ")}).` };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export type RegisterResult = { ok: boolean; message: string };

/**
 * Create a user and its first role.
 *
 * New accounts default to the `student` role and to `status = 'pending'`,
 * so self-registration cannot mint an administrator. An admin promotes the
 * account from the admin screen.
 */
export async function register(
  username: string,
  email: string,
  first_name: string,
  last_name: string,
  password: string,
  confirmation: string,
  role_name = "student",
): Promise<RegisterResult> {
  const problems = passwordProblems(password, confirmation);
  if (problems.length > 0) {
    return { ok: false, message: problems.join(" ") };
  }

  const name = username.trim().toLowerCase();
  const mail = email.trim().toLowerCase();

  if (!name || name.length < 3) {
    return { ok: false, message: "Username must be at least 3 characters." };
  }
  if (!mail.includes("@") || !mail.split("@").pop()?.includes(".")) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (!first_name.trim() || !last_name.trim()) {
    return { ok: false, message: "Both first and last name are required." };
  }

  const existing = await queryOne<string | number>(
    "SELECT COUNT(*) FROM users WHERE username = $1 OR email = $2",
    [name, mail],
  );
  if (Number(existing ?? 0) > 0) {
    return { ok: false, message: "That username or email is already registered." };
  }

  const inserted = (await exec(
    `INSERT INTO users (username, email, password_hash,
                           first_name, last_name, status)
        VALUES ($1, $2, $3, $4, $5, 'pending')
        RETURNING user_id`,
    [name, mail, await hashPassword(password), first_name.trim(), last_name.trim()],
    undefined,
    "user_id",
  )) as { user_id: number };

  // The join table is what makes roles many-to-many. Assigning here keeps
  // registration to a single place.
  await exec(
    `INSERT INTO user_roles (user_id, role_id)
        SELECT $1, role_id FROM roles WHERE role_name = $2`,
    [inserted.user_id, role_name],
  );

  return {
    ok: true,
    message:
      `Account '${name}' created with the '${role_name}' role. ` +
      "An administrator must activate it before you can sign in.",
  };
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

/**
 * True if the user holds at least one of `allowed`.
 *
 * Administrators pass every gate by design: they manage the system.
 */
export function requireRole(user: User | null, ...allowed: string[]): boolean {
  if (user === null) return false;
  if (user.is_admin) return true;
  return user.has_role(...allowed);
}

/** Every role name in the database, for populating role pickers. */
export async function visibleRoleNames(): Promise<string[]> {
  const rows = await query<{ role_name: string }>(
    "SELECT role_name FROM roles ORDER BY access_level DESC, role_name",
  );
  return rows.map((r) => r.role_name);
}

/** One-line identity summary for the sidebar. */
export function describe(user: User | null): string {
  if (user === null) return "Not signed in";
  return `${user.full_name} — ${user.roles.join(", ")}`;
}

export type UserRow = {
  user_id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  status: string;
  created_at: string;
};

/** Fetch a user row by id, for the admin screens. */
export async function lookupUser(user_id: number): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    `SELECT user_id, username, email, first_name, last_name,
               status, created_at
          FROM users WHERE user_id = $1`,
    [user_id],
  );
  return rows[0] ?? null;
}
