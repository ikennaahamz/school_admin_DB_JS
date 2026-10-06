import { redirect } from "next/navigation";

import { LoginForms } from "@/components/LoginForms";
import { DEFAULT_PATH } from "@/lib/nav";
import { currentUser } from "@/lib/session";

/**
 * Sign in and register.
 *
 * The Python app showed both forms on one page, with the sidebar reduced to
 * "Sign in to continue". That is reproduced here by the route group: this
 * page is outside `app/(app)/`, so it renders without the authenticated
 * layout, sidebar or navigation.
 *
 * A signed-in visitor is sent straight on. `app.py` left them on the login
 * form with the sidebar populated, which is a smaller version of the same
 * mistake -- the form is still there, underneath a working session.
 */
export default async function LoginPage() {
  const user = await currentUser();
  if (user !== null) redirect(DEFAULT_PATH);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">School Administration System</h1>
        <p className="text-slate-600">
          Database-backed student records, enrolment, grading and management reporting.
        </p>
        <p className="text-sm text-slate-500">CMPE344 · Database Management Systems and Programming II</p>
      </header>

      <LoginForms />
    </main>
  );
}
