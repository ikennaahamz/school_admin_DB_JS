"use client";

/**
 * The sign-out control.
 *
 * A form posting a server action rather than a link or a `fetch`, because
 * signing out has to clear an HTTP-only cookie -- which only the server can
 * do. `<form action={logoutAction}>` gives that for free and degrades
 * correctly without JavaScript, unlike an onClick handler.
 */

import { logoutAction } from "@/lib/actions/auth";

export function SignOutButton() {
  return (
    <form action={logoutAction}>
      <button
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
        type="submit"
      >
        Sign out
      </button>
    </form>
  );
}
