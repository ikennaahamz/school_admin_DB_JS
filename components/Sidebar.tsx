/**
 * The sidebar.
 *
 * Server-rendered, not a client component: the navigation is derived from
 * the session, and shipping the role list to the browser to filter it there
 * would mean sending every screen's permitted roles to every visitor.
 * Filtering on the server also means the rendered list and the guard in
 * `lib/guard.ts` are working from the same `SCREENS` registry.
 */

import Link from "next/link";

import { SignOutButton } from "@/components/SignOutButton";
import type { User } from "@/lib/auth";
import { visibleScreens } from "@/lib/nav";

export function Sidebar({ user }: { user: User }) {
  const screens = visibleScreens(user);

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-slate-200 bg-slate-50 p-4">
      <div className="space-y-1">
        <p className="font-semibold text-slate-900">School Administration</p>
        <p className="text-xs text-slate-500">CMPE344 · DBMS and Programming II</p>
      </div>

      <div className="space-y-1 border-t border-slate-200 pt-4">
        <p className="font-medium text-slate-900">{user.full_name}</p>
        <p className="text-xs text-slate-500">
          {user.username} · level {user.access_level}
        </p>
        <ul className="mt-1 space-y-0.5">
          {user.roles.map((role) => (
            <li className="text-xs text-slate-600" key={role}>
              • {role}
            </li>
          ))}
        </ul>
      </div>

      <nav className="border-t border-slate-200 pt-4" aria-label="Screens">
        <ul className="space-y-0.5">
          {screens.map((screen) => {
            const Icon = screen.icon;
            return (
              <li key={screen.key}>
                <Link
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200"
                  href={screen.href}
                >
                  <Icon aria-hidden className="h-4 w-4" size={16} />
                  {screen.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto border-t border-slate-200 pt-4">
        <SignOutButton />
      </div>
    </aside>
  );
}
