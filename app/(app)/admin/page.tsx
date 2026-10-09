import Link from "next/link";

import { DataTable } from "@/components/DataTable";
import { Field, SelectField, SubmitButton, Tabs } from "@/components/Form";
import { Flash } from "@/components/Flash";
import {
  createUserAction,
  grantRoleAction,
  revokeRoleAction,
  setUserStatusAction,
} from "@/lib/actions/crud";
import { visibleRoleNames } from "@/lib/auth";
import { readFlash } from "@/lib/flash";
import { requireScreen } from "@/lib/guard";
import { listGradeAudit } from "@/lib/queries/lookups";
import { listUsers, type UserRow } from "@/lib/queries/users";

/**
 * User administration.
 *
 * Admin-only, enforced by `requireScreen` before the first query runs.
 *
 * The Python screen began with its own `require_role` check and printed an
 * error for anyone else. That is gone: the guard redirects, because a page
 * that renders "this screen requires the administrator role" is still a
 * page an unauthorised visitor reached.
 */

const TABS = [
  { key: "accounts", label: "Accounts" },
  { key: "create", label: "Create" },
  { key: "audit", label: "Grade audit" },
];

const STATUSES = ["active", "suspended", "pending"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** `"(no roles)"` is the sentinel listUsers substitutes; not a role. */
function heldRoles(roles: string): string[] {
  return roles === "(no roles)" ? [] : roles.split(", ").filter(Boolean);
}

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  await requireScreen("admin");

  const params = await searchParams;
  const tab = TABS.some((t) => t.key === first(params.tab)) ? first(params.tab) : "accounts";
  const flash = readFlash(params);

  const [users, roleNames] = await Promise.all([listUsers(), visibleRoleNames()]);
  const pick = first(params.pick);
  const current = users.find((u) => String(u.user_id) === pick);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">User Administration</h1>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      <Tabs active={tab} tabs={TABS} />

      {tab === "accounts" ? <AccountsTab current={current} roleNames={roleNames} users={users} /> : null}
      {tab === "create" ? <CreateTab roleNames={roleNames} /> : null}
      {tab === "audit" ? <AuditTab /> : null}
    </div>
  );
}

/**
 * Status changes are inline on every row.
 *
 * This was previously behind a dropdown plus a "Load" button, so the panel
 * with the status control did not exist until you had already selected an
 * account. The table displayed a Status column and offered no way to act
 * on it, which reads as a missing button rather than as a hidden step.
 * Status is a single decision about one field, so it belongs on the row.
 *
 * Granting and revoking a role stays in the detail panel: each needs a role
 * chosen from the ones not held, so it is two controls rather than one, and
 * putting that on all 35 rows would bury the table. It is now one click
 * away instead of two.
 */
function StatusControl({ user }: { user: UserRow }) {
  return (
    <form action={setUserStatusAction} className="flex items-center justify-end gap-1">
      <input name="user_id" type="hidden" value={user.user_id} />
      <input name="username_label" type="hidden" value={user.username} />
      <select
        aria-label={`Status for ${user.username}`}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
        defaultValue={user.status}
        name="status"
      >
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <button
        className="rounded-md bg-sky-600 px-2 py-1 text-xs font-semibold text-white hover:bg-sky-700"
        type="submit"
      >
        Apply
      </button>
    </form>
  );
}

function AccountsTab({
  users,
  current,
  roleNames,
}: {
  users: UserRow[];
  current: UserRow | undefined;
  roleNames: string[];
}) {
  const pending = users.filter((u) => u.status === "pending");

  return (
    <div className="space-y-6">
      {/* An administrator's first question is "who needs activating", so it
          is answered above the table rather than discovered by scanning a
          Status column. */}
      {pending.length > 0 ? (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">
            {pending.length} account{pending.length === 1 ? "" : "s"} awaiting activation
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Self-registration creates a <em>pending</em> account, so nobody can sign in until an
            administrator approves them.
          </p>
          <ul className="mt-3 space-y-2">
            {pending.map((user) => (
              <li className="flex items-center justify-between gap-3 text-sm" key={user.user_id}>
                <span>
                  <strong>{user.username}</strong> · {user.full_name} · {user.email}
                </span>
                <StatusControl user={user} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {current === undefined ? null : <RolePanel current={current} roleNames={roleNames} />}

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-900">All accounts</h2>
        <AccountsTable users={users} />
      </section>
    </div>
  );
}

/**
 * Plain server-rendered markup rather than `DataTable`.
 *
 * Every row carries a form, and a form needs a server action. Actions can
 * cross the server/client boundary but function-valued props cannot, so a
 * client `DataTable` cannot take a cell renderer here. Writing the table
 * in the screen is both the only option and the same pattern the CRUD
 * delete tabs already use.
 */
function AccountsTable({ users }: { users: UserRow[] }) {
  if (users.length === 0) return <p className="text-sm text-slate-500">No accounts.</p>;

  return (
    <div className="overflow-auto rounded-md border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-left">
          <tr>
            <th className="px-3 py-2 font-medium text-slate-700" scope="col">ID</th>
            <th className="px-3 py-2 font-medium text-slate-700" scope="col">Username</th>
            <th className="px-3 py-2 font-medium text-slate-700" scope="col">Name</th>
            <th className="px-3 py-2 font-medium text-slate-700" scope="col">Email</th>
            <th className="px-3 py-2 font-medium text-slate-700" scope="col">Status</th>
            <th className="px-3 py-2 font-medium text-slate-700" scope="col">Roles</th>
            <th className="px-3 py-2 text-right font-medium text-slate-700" scope="col">Set status</th>
            <th className="px-3 py-2 text-right font-medium text-slate-700" scope="col">Role actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr className="border-t border-slate-100" key={user.user_id}>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{user.user_id}</td>
              <td className="px-3 py-1.5 font-medium text-slate-900">{user.username}</td>
              <td className="px-3 py-1.5 text-slate-800">{user.full_name}</td>
              <td className="px-3 py-1.5 text-slate-600">{user.email}</td>
              <td className="px-3 py-1.5">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                    user.status === "pending"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {user.status}
                </span>
              </td>
              <td className="px-3 py-1.5 text-slate-700">{user.roles}</td>
              <td className="px-3 py-1.5">
                <StatusControl user={user} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <Link
                  className="text-sm text-sky-700 underline underline-offset-2 hover:text-sky-900"
                  href={`?tab=accounts&pick=${user.user_id}`}
                >
                  Manage
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RolePanel({ current, roleNames }: { current: UserRow; roleNames: string[] }) {
  const held = heldRoles(current.roles);
  const available = roleNames.filter((r) => !held.includes(r));

  return (
    <section className="max-w-xl space-y-4 rounded-md border border-slate-300 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-slate-700">
          <p>
            <strong>{current.full_name}</strong> · <code>{current.username}</code> · {current.email}
          </p>
          <p className="text-xs text-slate-500">
            id {current.user_id} · currently {current.status}
          </p>
        </div>
        <Link className="text-xs text-slate-500 underline underline-offset-2" href="?tab=accounts">
          Close
        </Link>
      </div>

      <p className="text-xs text-slate-500">
        Roles are read on every request, so a change here takes effect immediately — there is no
        session to invalidate.
      </p>

      {available.length === 0 ? (
        <p className="text-sm text-slate-500">This account already holds every role.</p>
      ) : (
        <form action={grantRoleAction} className="flex items-end gap-3">
          <input name="user_id" type="hidden" value={current.user_id} />
          <div className="flex-1 space-y-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="grant_role">
              Grant role
            </label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              id="grant_role"
              name="role"
            >
              {available.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton>Grant</SubmitButton>
        </form>
      )}

      {held.length === 0 ? (
        <p className="text-sm text-slate-500">This account has no roles.</p>
      ) : (
        <form action={revokeRoleAction} className="flex items-end gap-3">
          <input name="user_id" type="hidden" value={current.user_id} />
          <div className="flex-1 space-y-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="revoke_role">
              Revoke role
            </label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              id="revoke_role"
              name="role"
            >
              {held.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton variant="danger">Revoke</SubmitButton>
        </form>
      )}
    </section>
  );
}

function CreateTab({ roleNames }: { roleNames: string[] }) {
  return (
    <form action={createUserAction} className="max-w-2xl space-y-4">
      <p className="text-sm text-slate-600">
        Unlike self-registration, an account created here is <strong>active immediately</strong> —
        an administrator has vouched for it. It still gets exactly one role.
      </p>

      <Field autoComplete="off" label="Username" maxLength={50} name="username" required />
      <Field autoComplete="off" label="Email" name="email" required type="email" />
      <Field autoComplete="off" label="First name" name="first_name" required />
      <Field autoComplete="off" label="Last name" name="last_name" required />
      <Field
        autoComplete="new-password"
        hint="At least 8 characters, with a letter and a digit."
        label="Password"
        name="password"
        required
        type="password"
      />
      <Field
        autoComplete="new-password"
        label="Confirm password"
        name="confirmation"
        required
        type="password"
      />
      <SelectField choices={roleNames} label="Role" name="role" />

      <SubmitButton>Create active account</SubmitButton>
    </form>
  );
}

async function AuditTab() {
  const rows = await listGradeAudit(100, true);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Every grade change, who made it, and what it changed. The audit rows carry no foreign keys
        on purpose, so they survive deletion of the enrolment they describe.
      </p>

      <DataTable
        caption="Grade audit"
        columns={[
          { key: "audit_id", header: "ID", numeric: true },
          { key: "changed_at", header: "Changed" },
          { key: "changed_by", header: "By" },
          { key: "student_no", header: "Student no" },
          { key: "student_name", header: "Student" },
          { key: "course_code", header: "Course" },
          { key: "old_grade", header: "Old", numeric: true },
          { key: "new_grade", header: "New", numeric: true },
          { key: "old_letter", header: "Old letter" },
          { key: "new_letter", header: "New letter" },
        ]}
        rows={rows as unknown as Record<string, unknown>[]}
      />
    </div>
  );
}