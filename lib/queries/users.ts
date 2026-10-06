/**
 * Admin: users and roles.
 *
 * Every write here takes an `actor`, because each of them is auditable --
 * activating an account, granting a role and creating a user are all
 * actions worth attributing, and `app.user` is what the grade trigger
 * reads and what these rows are read back against.
 */

import { hashPassword } from "@/lib/auth";
import { exec, query } from "@/lib/db";

export type UserRow = {
  user_id: number;
  username: string;
  email: string;
  full_name: string;
  status: string;
  created_at: Date;
  roles: string;
  /**
   * COUNT() over a LEFT JOIN, so this is 0 or 1 rather than a boolean.
   * Kept as the database returns it because the admin screen renders it
   * as a count and the Python original did the same.
   */
  is_student: string;
  is_instructor: string;
};

export async function listUsers(): Promise<UserRow[]> {
  return query<UserRow>(
    `
        SELECT u.user_id, u.username, u.email,
               u.first_name || ' ' || u.last_name AS full_name,
               u.status, u.created_at,
               COALESCE(STRING_AGG(r.role_name, ', ' ORDER BY r.role_name),
                        '(no roles)') AS roles,
               COUNT(s.student_id)    AS is_student,
               COUNT(i.instructor_id) AS is_instructor
          FROM users u
          LEFT JOIN user_roles ur ON ur.user_id = u.user_id
          LEFT JOIN roles r       ON r.role_id = ur.role_id
          LEFT JOIN students s    ON s.user_id = u.user_id
          LEFT JOIN instructors i ON i.user_id = u.user_id
         GROUP BY u.user_id, u.username, u.email, u.first_name,
                  u.last_name, u.status, u.created_at
         ORDER BY u.username
        `,
  );
}

/**
 * Activate, suspend or pend an account.
 *
 * Deleting a user is intentionally not offered: users are referenced by
 * instructors, students, submissions and the grade audit trail.
 * Suspension preserves the records.
 */
export async function setUserStatus(userId: number, status: string, actor: string): Promise<void> {
  await exec("UPDATE users SET status = $1::user_status WHERE user_id = $2", [status, userId], actor);
}

export async function grantRole(userId: number, roleName: string, actor: string): Promise<void> {
  await exec(
    `
        INSERT INTO user_roles (user_id, role_id)
        SELECT $1, role_id FROM roles WHERE role_name = $2
        ON CONFLICT (user_id, role_id) DO NOTHING
        `,
    [userId, roleName],
    actor,
  );
}

export async function revokeRole(userId: number, roleName: string, actor: string): Promise<void> {
  await exec(
    `
        DELETE FROM user_roles
         WHERE user_id = $1
           AND role_id = (SELECT role_id FROM roles WHERE role_name = $2)
        `,
    [userId, roleName],
    actor,
  );
}

export type NewUser = {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  role_name: string;
};

/**
 * Create an active user with one role.
 *
 * Used by the admin screen. Unlike `auth.register` the account is active
 * immediately, because an administrator has vouched for it.
 *
 * Note the two writes are not one transaction. That is faithful to the
 * Python original, where each `db.execute` opened its own connection, and
 * it is a real weakness: a failure between them leaves a user with no
 * role. `auth.register` has the same shape. Wrapping both in one
 * transaction needs a client-scoped helper in `lib/db.ts`, which is a
 * deliberate Phase 6 item rather than something to smuggle in here -- the
 * orphan is recoverable and the behaviour change is not.
 */
export async function createUser(newUser: NewUser, actor: string): Promise<number> {
  const row = (await exec(
    `
        INSERT INTO users (username, email, password_hash,
                           first_name, last_name, status)
        VALUES ($1, $2, $3, $4, $5, 'active')
        RETURNING user_id
        `,
    [
      newUser.username.trim().toLowerCase(),
      newUser.email.trim().toLowerCase(),
      await hashPassword(newUser.password),
      newUser.first_name.trim(),
      newUser.last_name.trim(),
    ],
    actor,
    "user_id",
  )) as { user_id: number };

  await exec(
    `
        INSERT INTO user_roles (user_id, role_id)
        SELECT $1, role_id FROM roles WHERE role_name = $2
        `,
    [row.user_id, newUser.role_name],
    actor,
  );

  return row.user_id;
}