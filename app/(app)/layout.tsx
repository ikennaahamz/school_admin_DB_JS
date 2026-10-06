import { Sidebar } from "@/components/Sidebar";
import { requireSession } from "@/lib/guard";

/**
 * Layout for every authenticated page.
 *
 * The guard lives here as well as in each page, and the duplication is
 * deliberate. A layout guard protects the shell -- so an unauthorised
 * visitor never sees the sidebar, the user identity or the navigation --
 * while `requireScreen()` in a page protects that page's data, and runs
 * before any query on it.
 *
 * Next.js may render a layout and a page concurrently, so a page cannot
 * rely on the layout having already redirected. Both check.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <main className="min-w-0 flex-1 overflow-x-auto p-6">{children}</main>
    </div>
  );
}
