/**
 * A one-shot message banner.
 *
 * The counterpart of `app.py::FLASH_HANDLERS`, which mapped a kind name to
 * one of Streamlit's four message boxes. Tailwind has no equivalent set of
 * components, so the four variants are expressed as class names on one
 * element.
 *
 * `kind` is constrained by the FlashKind type and, on the way in from a
 * URL, by `readFlash`. The lookup below is a total function over the four
 * kinds rather than an object index that could miss, because a missing
 * class silently renders a banner with no styling.
 */

import type { FlashKind } from "@/lib/flash";

const STYLES: Record<FlashKind, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  error: "border-red-300 bg-red-50 text-red-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  info: "border-sky-300 bg-sky-50 text-sky-900",
};

export function Flash({ kind, message }: { kind: FlashKind; message: string }) {
  return (
    <div
      // `status` rather than `alert`: an error banner on a page the user
      // just navigated to is announced, but an assertive alert interrupts
      // whatever they were doing for a routine confirmation.
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-md border px-4 py-3 text-sm whitespace-pre-line ${STYLES[kind]}`}
    >
      {message}
    </div>
  );
}
