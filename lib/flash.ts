/**
 * One-shot messages.
 *
 * The Python app kept a `flash` key in `st.session_state`, stashed a
 * message during a button callback and rendered it on the next rerun,
 * popping it as it went. Streamlit needed that because it redraws the whole
 * script on every interaction; a message set during a callback has nowhere
 * else to live.
 *
 * Next.js has no equivalent of that. A Server Action ends by redirecting,
 * and a redirect discards everything except the URL and the cookies -- so
 * the message has to travel in one of those two.
 *
 * It travels in the URL. A short-lived HTTP-only cookie was the other
 * option and is the tidier design, but a cookie cannot be deleted from a
 * Server Component: `cookies().delete()` is only permitted in a Server
 * Action or Route Handler. Reading it in a layout would therefore leave it
 * set, and the message would reappear on every navigation until it expired.
 * A query parameter has no such problem and no clearing step at all.
 *
 * The trade-off is that the message is visible in the address bar and in
 * browser history. That is acceptable here because every message is either
 * authored by this code or is a database error that `lib/db.ts` has already
 * stripped of credentials, and both are bounded below.
 */

export type FlashKind = "success" | "error" | "warning" | "info";

const PARAM = "flash";
const MESSAGE_PARAM = "msg";

/**
 * Long enough for a constraint message plus its SQLSTATE, short enough that
 * a URL cannot be pushed somewhere unhelpful.
 */
const MAX_MESSAGE = 500;

export type Flash = { kind: FlashKind; message: string };

const KINDS: readonly FlashKind[] = ["success", "error", "warning", "info"];

/**
 * Append a flash to a path.
 *
 * Truncates rather than rejecting: a message cut short with an ellipsis is
 * still a useful message, and dropping it would lose the whole explanation
 * because one sentence was long.
 */
export function withFlash(path: string, kind: FlashKind, message: string): string {
  const trimmed =
    message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message;
  const params = new URLSearchParams({ [PARAM]: kind, [MESSAGE_PARAM]: trimmed });
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${params.toString()}`;
}

/**
 * Read a flash out of a page's search params.
 *
 * Returns null when either parameter is missing or the kind is not one of
 * the four. That matters because these values arrive from the URL, which
 * means they arrive from whoever wrote the URL -- the `kind` is used to
 * pick a CSS class, so an unrecognised value is treated as absent rather
 * than interpolated.
 */
export function readFlash(params: Record<string, string | string[] | undefined>): Flash | null {
  const rawKind = first(params[PARAM]);
  const rawMessage = first(params[MESSAGE_PARAM]);

  if (rawKind === undefined || rawMessage === undefined) return null;
  if (!KINDS.includes(rawKind as FlashKind)) return null;
  if (rawMessage === "") return null;

  return { kind: rawKind as FlashKind, message: rawMessage };
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
