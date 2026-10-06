/**
 * Authentication server actions.
 *
 * These replace the `if submitted:` blocks in `app.py::render_login`.
 * Everything runs on the server: the password never reaches the browser,
 * and `bcrypt.compare` is not something a client may be trusted to decide.
 */

"use server";

import { redirect } from "next/navigation";

import { authenticate, register } from "@/lib/auth";
import { DatabaseError } from "@/lib/db";
import { withFlash } from "@/lib/flash";
import { DEFAULT_PATH, SIGN_IN_PATH } from "@/lib/nav";
import { endSession, startSession } from "@/lib/session";

export type AuthFormState = {
  /** A message to show on the form itself. The form is not redirected. */
  error?: string;
  /** A message to show on the form itself, but not an error. */
  notice?: string;
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function loginAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const username = field(formData, "username");
  const password = field(formData, "password");

  // authenticate() is outside nothing that catches its own redirect: the
  // two failure modes below are distinct, and a DatabaseError here is a
  // connectivity or constraint problem rather than a bad password.
  let result;
  try {
    result = await authenticate(username, password);
  } catch (err) {
    if (err instanceof DatabaseError) return { error: err.message };
    throw err;
  }

  if (result.user === null) {
    // One message for "no such user" and "wrong password", deliberately
    // identical -- see the note in lib/auth.ts.
    return { error: result.message };
  }

  await startSession(result.user.user_id);

  // Outside the try on purpose: redirect() signals by throwing a sentinel
  // error, and a surrounding catch would swallow it and leave the user
  // staring at the login form with a valid session cookie.
  redirect(withFlash(DEFAULT_PATH, "success", result.message));
}

export async function registerAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  try {
    const result = await register(
      field(formData, "username"),
      field(formData, "email"),
      field(formData, "first_name"),
      field(formData, "last_name"),
      field(formData, "password"),
      field(formData, "confirmation"),
    );

    // A new account is pending, so there is nothing to sign in to yet.
    // Stay on the form and explain why.
    return result.ok ? { notice: result.message } : { error: result.message };
  } catch (err) {
    if (err instanceof DatabaseError) return { error: err.message };
    throw err;
  }
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect(SIGN_IN_PATH);
}
