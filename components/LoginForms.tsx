"use client";

/**
 * The sign-in and registration forms.
 *
 * Client-side only because `useActionState` needs React state to re-render
 * the form with the server's verdict. The decision itself is a server
 * action: nothing here decides whether a password is correct, and no
 * password value is ever read into a variable that could be logged.
 */

import Link from "next/link";
import { useActionState } from "react";

import { Flash } from "@/components/Flash";
import { loginAction, registerAction, type AuthFormState } from "@/lib/actions/auth";

const EMPTY: AuthFormState = {};

const FIELD =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm " +
  "focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";

const LABEL = "block text-sm font-medium text-slate-700";

export function LoginForms() {
  const [loginState, login, loginPending] = useActionState(loginAction, EMPTY);
  const [registerState, register, registerPending] = useActionState(registerAction, EMPTY);

  return (
    <div className="space-y-8">
      <form action={login} className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Sign in</h2>

        {loginState.error ? <Flash kind="error" message={loginState.error} /> : null}

        <div className="space-y-1">
          <label className={LABEL} htmlFor="username">
            Username
          </label>
          <input
            className={FIELD}
            id="username"
            name="username"
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="password">
            Password
          </label>
          <input
            className={FIELD}
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <button
          className="w-full rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
          disabled={loginPending}
          type="submit"
        >
          {loginPending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <form action={register} className="space-y-4 border-t border-slate-200 pt-6">
        <h2 className="text-lg font-semibold text-slate-900">Register</h2>
        <p className="text-sm text-slate-600">
          New accounts start as <em>pending</em> with the <em>student</em> role. An administrator
          activates them before you can sign in.
        </p>

        {registerState.error ? <Flash kind="error" message={registerState.error} /> : null}
        {registerState.notice ? <Flash kind="success" message={registerState.notice} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="r_username">
              Username
            </label>
            <input className={FIELD} id="r_username" name="username" required />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="r_email">
              Email
            </label>
            <input className={FIELD} id="r_email" name="email" type="email" required />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="r_first_name">
              First name
            </label>
            <input className={FIELD} id="r_first_name" name="first_name" required />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="r_last_name">
              Last name
            </label>
            <input className={FIELD} id="r_last_name" name="last_name" required />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="r_password">
              Password
            </label>
            <input
              className={FIELD}
              id="r_password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="r_confirmation">
              Confirm password
            </label>
            <input
              className={FIELD}
              id="r_confirmation"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
        </div>

        <button
          className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          disabled={registerPending}
          type="submit"
        >
          {registerPending ? "Creating…" : "Create account"}
        </button>
      </form>

      <details className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Demo accounts</summary>
        <p className="mt-2 text-slate-600">All demo accounts use the password <code>Passw0rd!</code></p>
        <table className="mt-3 w-full text-left">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1 pr-4 font-medium">Username</th>
              <th className="py-1 pr-4 font-medium">Role(s)</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {[
              ["admin", "admin"],
              ["registrar", "registrar"],
              ["i.kaya", "instructor, CS"],
              ["i.koc", "instructor, technical"],
              ["student1", "student"],
              ["student2", "student"],
            ].map(([username, roles]) => (
              <tr key={username}>
                <td className="py-1 pr-4">{username}</td>
                <td className="py-1 pr-4 font-sans text-slate-600">{roles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="text-xs text-slate-500">
        <Link href="/" className="hover:underline">
          Return to the start
        </Link>
      </p>
    </div>
  );
}
