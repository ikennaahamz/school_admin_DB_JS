/**
 * The screen registry.
 *
 * Ported from the `SCREENS` list in the Python `app.py`. Each screen
 * declares the roles allowed to open it, and the same declaration drives
 * both the sidebar and the server-side guard, so a screen can never appear
 * in the navigation while being unreachable (or the reverse).
 *
 * Kept free of `next/navigation` and of any request scope on purpose: the
 * role predicate is the part most worth testing, and it should be testable
 * without a running server. The redirect lives in `lib/guard.ts`.
 */

import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { requireRole, type User } from "@/lib/auth";

export type ScreenKey =
  | "dashboard"
  | "students"
  | "instructors"
  | "sections"
  | "enrollments"
  | "assignments"
  | "attendance"
  | "reports"
  | "admin";

export type Screen = {
  key: ScreenKey;
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Roles allowed to open this screen.
   *
   * An EMPTY array means "no restriction", so the dashboard is reachable by
   * anyone signed in. Passing an empty list to `requireRole()` instead
   * would ask whether the user holds any of zero roles, which is false for
   * everyone but an administrator -- the same trap the Python `_gate()`
   * comment warns about.
   */
  roles: readonly string[];
};

export const SCREENS: readonly Screen[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: [] },
  { key: "students", label: "Students", href: "/students", icon: GraduationCap, roles: ["admin", "registrar"] },
  { key: "instructors", label: "Instructors", href: "/instructors", icon: Users, roles: ["admin", "registrar"] },
  {
    key: "sections",
    label: "Courses",
    href: "/sections",
    icon: BookOpen,
    roles: ["admin", "registrar", "instructor"],
  },
  {
    key: "enrollments",
    label: "Enrolments",
    href: "/enrollments",
    icon: ClipboardList,
    roles: ["admin", "registrar", "instructor"],
  },
  {
    key: "assignments",
    label: "Assignments",
    href: "/assignments",
    icon: FileText,
    roles: ["admin", "registrar", "instructor"],
  },
  {
    key: "attendance",
    label: "Attendance",
    href: "/attendance",
    icon: CalendarCheck,
    roles: ["admin", "registrar", "instructor"],
  },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    roles: ["admin", "registrar", "instructor", "student"],
  },
  { key: "admin", label: "User Admin", href: "/admin", icon: ShieldCheck, roles: ["admin"] },
] as const;

export function screenByKey(key: string): Screen | undefined {
  return SCREENS.find((s) => s.key === key);
}

/** True when the user may open this screen. Null user is never allowed. */
export function canOpen(user: User | null, screen: Screen): boolean {
  if (user === null) return false;
  if (screen.roles.length === 0) return true;
  return requireRole(user, ...screen.roles);
}

/** The screens to show in the sidebar, in registry order. */
export function visibleScreens(user: User | null): Screen[] {
  return SCREENS.filter((s) => canOpen(user, s));
}

/**
 * Where an unauthenticated visitor should land.
 *
 * A separate function because it appears in three places -- the root
 * redirect, the layout guard, and the post-logout redirect -- and they
 * must not drift apart.
 */
export const SIGN_IN_PATH = "/login";

/** Where to send a signed-in user who has no business being on a public page. */
export const DEFAULT_PATH = "/dashboard";
