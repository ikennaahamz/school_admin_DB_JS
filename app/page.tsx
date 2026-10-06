import { redirect } from "next/navigation";

import { DEFAULT_PATH, SIGN_IN_PATH } from "@/lib/nav";
import { currentUser } from "@/lib/session";

/**
 * The entry point.
 *
 * `/` is a router and nothing else -- no page of its own. The Python app
 * drew its landing content on the same screen as the sign-in form; here the
 * choice is made before anything renders, so an authenticated visit to `/`
 * costs one redirect instead of shipping a login page to someone who
 * already has a session.
 */
export default async function IndexPage() {
  const user = await currentUser();
  redirect(user === null ? SIGN_IN_PATH : DEFAULT_PATH);
}
