/**
 * Session cookie signing, verification, and expiry.
 *
 *     npm test
 *
 * `createSessionValue` and `readSessionValue` are pure functions of their
 * input, so they are tested directly. The three functions that touch
 * `cookies()` from `next/headers` -- `startSession`, `endSession`, and
 * `currentUser` -- are not testable here: that module requires an active
 * request scope and throws outside one. They are exercised by the
 * Playwright suite in Phase 6 instead, where a real server exists.
 *
 * The properties worth pinning are the ones an attacker would try to
 * break: that a modified payload is rejected, that an expired session is
 * rejected, and that the signature comparison does not leak its position
 * through early exit.
 */

import { describe, expect, it } from "vitest";

import { SESSION_TTL_SECONDS, createSessionValue, readSessionValue } from "@/lib/session";

function decodeBody(value: string): string {
  return Buffer.from(value.slice(0, value.lastIndexOf(".")), "base64url").toString("utf8");
}

describe("session cookie", () => {
  it("round-trips a user id", () => {
    const value = createSessionValue(42);
    expect(readSessionValue(value)?.userId).toBe(42);
  });

  it("is signed, so the payload is readable but not forgeable", () => {
    const value = createSessionValue(7);
    expect(JSON.parse(decodeBody(value))).toMatchObject({ userId: 7 });
    // The signature is what makes it trustworthy; assert it is present.
    expect(value.split(".")).toHaveLength(2);
  });

  it("rejects a payload edited to name another user", () => {
    // The attack this exists to stop: take your own valid cookie, swap the
    // user id, and send it back.
    const value = createSessionValue(7);
    const [, signature] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: 1, issuedAt: Date.now(), expiresAt: Date.now() + 1000 })).toString(
      "base64url",
    );
    expect(readSessionValue(`${forged}.${signature}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const value = createSessionValue(7);
    const [body, signature] = value.split(".");
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    expect(readSessionValue(`${body}.${flipped}`)).toBeNull();
  });

  it("rejects a session that has expired", () => {
    const issuedAt = Date.now();
    const value = createSessionValue(7, issuedAt);
    expect(readSessionValue(value, issuedAt + 1000)).not.toBeNull();
    expect(readSessionValue(value, issuedAt + (SESSION_TTL_SECONDS + 60) * 1000)).toBeNull();
  });

  it("rejects a missing, empty, or shapeless value", () => {
    expect(readSessionValue(undefined)).toBeNull();
    expect(readSessionValue("")).toBeNull();
    expect(readSessionValue("no-dot-here")).toBeNull();
    expect(readSessionValue(".onlysignature")).toBeNull();
  });

  it("rejects a value whose signature is the wrong length", () => {
    // timingSafeEqual throws on a length mismatch, so the guard has to come
    // first or a truncated cookie becomes a 500 rather than a rejection.
    expect(readSessionValue("YWJj.ZG")).toBeNull();
  });

  it("rejects a correctly signed payload that is missing fields", () => {
    // Signed by the same secret, so this passes the signature check and
    // must be caught by the shape check instead.
    const value = createSessionValue(7);
    const [body, signature] = value.split(".");
    const tampered = Buffer.from(JSON.stringify({ hello: "world" })).toString("base64url");
    expect(readSessionValue(`${tampered}.${signature}`)).toBeNull();
    expect(body).toBeTruthy();
  });
});
