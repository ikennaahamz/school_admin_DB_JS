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
import { listUsers } from "@/lib/queries/users";

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

      {tab === "accounts" ? (
        <div className="space-y-6">
          <form className="flex items-end gap-3" method="get">
            <input name="tab" type="hidden" value="accounts" />
            <div className="min-w-80 space-y-1">
              <label className="block text-sm font-medium text-slate-700" htmlFor="pick">
                Account
              </label>
              <select
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                defaultValue={pick}
                id="pick"
                name="pick"
              >
                <option value="">(choose an account)</option>
                {users.map((user) => (
                  <option key={user.user_id} value={user.user_id}>
                    {user.full_name} ({user.username})
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton variant="plain">Load</SubmitButton>
          </form>

          {current === undefined ? null : (
            <section className="max-w-xl space-y-4 rounded-md border border-slate-200 p-4">
              <p className="text-sm text-slate-700">
                <strong>{current.full_name}</strong> · <code>{current.username}</code> ·{" "}
                {current.email}
                <br />
                Status: <strong>{current.status}</strong> · Roles: {current.roles}
              </p>

              <form action={setUserStatusAction} className="space-y-3">
                <input name="user_id" type="hidden" value={current.user_id} />
                <input name="username_label" type="hidden" value={current.username} />
                <SelectField defaultValue={current.status} label="Status" name="status" choices={STATUSES} />
                <SubmitButton>Apply status</SubmitButton>
              </form>

              <hr className="border-slate-200" />

              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Granting or revoking a role takes effect on the account&apos;s next request — the
                  session cookie holds only a user id, so roles are re-read every time.
                </p>

                {(() => {
                  const held = heldRoles(current.roles);
                  const available = roleNames.filter((r) => !held.includes(r));

                  return (
                    <div className="space-y-4">
                      {available.length === 0 ? (
                        <p className="text-sm text-slate-500">This account holds every role.</p>
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
                    </div>
                  );
                })()}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-semibold text-slate-900">All accounts</h2>
            <DataTable
              caption="All user accounts"
              columns={[
                { key: "user_id", header: "ID", numeric: true },
                { key: "username", header: "Username" },
                { key: "full_name", header: "Name" },
                { key: "email", header: "Email" },
                { key: "status", header: "Status" },
                { key: "roles", header: "Roles" },
                { key: "is_student", header: "Student", numeric: true },
                { key: "is_instructor", header: "Instructor", numeric: true },
              ]}
              rows={users as unknown as Record<string, unknown>[]}
            />
          </section>
        </div>
      ) : null}

      {tab === "create" ? <CreateTab roleNames={roleNames} /> : null}
      {tab === "audit" ? <AuditTab /> : null}
    </div>
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
