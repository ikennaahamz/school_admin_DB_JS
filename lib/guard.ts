/**
 * Server-side guards for every authenticated page.
 *
 * This is the one place the rewrite is deliberately *stronger* than what it
 * replaces. The Streamlit app gated roles in the presentation layer only:
 * `app.py::_gate()` decided whether to draw a screen, and the module
 * docstring conceded that "role checks happen in the presentation layer
 * only as a convenience to the user". A Streamlit app has no server-side
 * request boundary to hide behind, so that was the whole of its protection.
 *
 * Next.js has one. Every page is a Server Component reached by an HTTP
 * request, and `redirect()` runs before any of the page's queries do. So
 * the role check here is the actual access control, not a convenience, and
 * a user who types a URL they are not entitled to is redirected before the
 * database is ever asked.
 *
 * Keeping this separate from `lib/nav.ts` also keeps the role predicate
 * testable without a request scope.
 */

import { redirect } from "next/navigation";

import type { User } from "@/lib/auth";
import { DEFAULT_PATH, SIGN_IN_PATH, canOpen, screenByKey, type ScreenKey } from "@/lib/nav";
import { currentUser } from "@/lib/session";

/**
 * The signed-in user, or a redirect to the sign-in page.
 *
 * `redirect()` throws, so the `return user` below is only reached when a
 * session actually exists.
 */
export async function requireSession(): Promise<User> {
  const user = await currentUser();
  if (user === null) redirect(SIGN_IN_PATH);
  return user;
}

/**
 * The signed-in user, if they may open this screen.
 *
 * An unknown screen key also redirects rather than 404s, because a key that
 * is not in the registry is not a screen this application serves.
 */
export async function requireScreen(key: ScreenKey): Promise<{ user: User; screen: NonNullable<ReturnType<typeof screenByKey>> }> {
  const user = await requireSession();
  const screen = screenByKey(key);

  if (screen === undefined || !canOpen(user, screen)) {
    redirect(DEFAULT_PATH);
  }

  return { user, screen };
}
