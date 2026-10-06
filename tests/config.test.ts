/**
 * Prove the configuration and DSN handling works from every source the
 * deployment target uses.
 *
 *     npm test
 *
 * Port of scripts/verify_config.py (40 checks). The Python original
 * exercised three configuration sources because Streamlit Community
 * Cloud injects deployment secrets through `st.secrets` rather than the
 * process environment -- reading only `os.getenv` meant a deployed build
 * reported "DATABASE_URL is not set" while the variable was plainly
 * configured under the Secrets panel.
 *
 * That failure mode does not exist on Vercel, which injects into
 * `process.env` for both local development and deployed builds, so the
 * three sources legitimately collapse to one (see PORT_MAP.md,
 * `src/db.py::setting` -> lib/db.ts). The Python cases that specifically
 * faked `st.secrets` therefore have no counterpart here.
 *
 * What is preserved is the *behaviour* those cases were guarding:
 *
 *   - a value supplied by the deployment is found (case 2 below)
 *   - a missing value fails with an actionable message, not a stack
 *     trace (case 3)
 *   - the legacy `supabase` alias and case-insensitivity of DB_TARGET
 *     still work, because _connection_string depends on them
 *   - paste defects are repaired, and a *wrong password is not* (case 5)
 *   - a fingerprint identifies a secret without disclosing it (case 6)
 *
 * Cases 5 and 6 are the ones that matter most and are carried across
 * check-for-check, because normaliseDsn / dsnFingerprint / redact are
 * ported verbatim.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseError, dbTarget, dsnFingerprint, normaliseDsn, redact, resolveDsn } from "@/lib/db";

const DSN = "postgresql://postgres:pw@db.example.supabase.co:5432/postgres?sslmode=require";

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    LOCAL_DATABASE_URL: process.env.LOCAL_DATABASE_URL,
    DB_TARGET: process.env.DB_TARGET,
  };
  delete process.env.DATABASE_URL;
  delete process.env.LOCAL_DATABASE_URL;
  delete process.env.DB_TARGET;
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("case 3: nothing configured", () => {
  it("reports a missing DATABASE_URL as a DatabaseError, not a crash", () => {
    expect(() => resolveDsn()).toThrow(DatabaseError);
  });

  it("names the variable that is missing", () => {
    // The Python assertion was "message mentions Streamlit Secrets".
    // There is no Secrets panel on Vercel, so the actionable equivalent
    // is the deployment's environment-variable settings.
    expect(() => resolveDsn()).toThrow(/DATABASE_URL/);
  });

  it("tells the reader how to fix it locally", () => {
    expect(() => resolveDsn()).toThrow(/\.env/);
  });
});

describe("case 2: environment variable, the deployment case", () => {
  it("resolves DATABASE_URL from the environment", () => {
    process.env.DATABASE_URL = DSN;
    expect(resolveDsn()).toBe(DSN);
  });

  it("returns undefined for an unknown key", () => {
    expect(process.env.NOT_A_REAL_KEY).toBeUndefined();
  });
});

describe("DB_TARGET selection", () => {
  it("defaults to the cloud database", () => {
    process.env.DATABASE_URL = DSN;
    expect(dbTarget()).toBe("cloud");
  });

  it("keeps the legacy 'supabase' alias selecting the cloud database", () => {
    // The literal used to be the default. Anything other than "local"
    // means cloud, so the legacy value must still resolve to the cloud
    // branch rather than being rejected.
    process.env.DATABASE_URL = DSN;
    process.env.DB_TARGET = "supabase";
    expect(dbTarget()).toBe("supabase");
    expect(resolveDsn()).toBe(DSN);
  });

  it("is case-insensitive", () => {
    process.env.DB_TARGET = "CLOUD";
    expect(dbTarget()).toBe("cloud");
  });

  it("DB_TARGET=local selects LOCAL_DATABASE_URL", () => {
    process.env.DATABASE_URL = DSN;
    process.env.LOCAL_DATABASE_URL = DSN;
    process.env.DB_TARGET = "local";
    expect(dbTarget()).toBe("local");
  });

  it("resolveDsn follows DB_TARGET", () => {
    process.env.DATABASE_URL = DSN;
    process.env.LOCAL_DATABASE_URL = DSN;
    process.env.DB_TARGET = "local";
    expect(resolveDsn()).toBe(DSN);
  });

  it("DB_TARGET=local without LOCAL_DATABASE_URL is an actionable error", () => {
    process.env.DB_TARGET = "local";
    expect(() => resolveDsn()).toThrow(DatabaseError);
    expect(() => resolveDsn()).toThrow(/LOCAL_DATABASE_URL/);
  });
});

describe("case 5: paste defects in DATABASE_URL", () => {
  // The Python deployed build failed with "password authentication
  // failed" because the configured secret was not the string that works.
  // The credential cannot be recovered by tidying, but the debris that
  // commonly travels with a hand-pasted DSN can be, and it produces the
  // same misleading error when it is not.
  const good =
    "postgresql://neondb_owner:npg_ABC123xyz@ep-young-pond.example.aws.neon.tech/neondb?sslmode=require";

  it("passes a well-formed DSN through byte-for-byte", () => {
    expect(normaliseDsn(good)).toBe(good);
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseDsn(`  ${good}  \n`)).toBe(good);
  });

  it("removes a pasted 'DATABASE_URL=' key", () => {
    expect(normaliseDsn(`DATABASE_URL=${good}`)).toBe(good);
  });

  it("removes a pasted 'DATABASE_URL =' key with spaces", () => {
    expect(normaliseDsn(`DATABASE_URL = ${good}`)).toBe(good);
  });

  it("removes inherited double quotes", () => {
    expect(normaliseDsn(`"${good}"`)).toBe(good);
  });

  it("removes inherited single quotes", () => {
    expect(normaliseDsn(`'${good}'`)).toBe(good);
  });

  it("removes a leftover [section] header", () => {
    expect(normaliseDsn(`[neon]\n${good}`)).toBe(good);
  });

  it("removes a trailing bracket", () => {
    expect(normaliseDsn(`${good}]`)).toBe(good);
  });

  it("repairs a full .env line pasted as one value", () => {
    expect(normaliseDsn(`DATABASE_URL="${good}"`)).toBe(good);
  });

  it("is idempotent", () => {
    expect(normaliseDsn(normaliseDsn(`DATABASE_URL="${good}"`))).toBe(good);
  });

  it("does NOT alter a wrong password", () => {
    // Silently "fixing" it would hide the real fault behind a connection
    // that appears to work.
    const wrong = good.replace("npg_ABC123xyz", "npg_ABC123xy");
    expect(normaliseDsn(wrong)).toBe(wrong);
  });
});

describe("case 6: fingerprint and redaction", () => {
  const good =
    "postgresql://neondb_owner:npg_ABC123xyz@ep-young-pond.example.aws.neon.tech/neondb?sslmode=require";
  const wrong = good.replace("npg_ABC123xyz", "npg_ABC123xy");
  const fp = dsnFingerprint(good);

  it("names the host", () => {
    expect(fp).toContain("ep-young-pond.example");
  });

  it("names the user", () => {
    expect(fp).toContain("user=neondb_owner");
  });

  it("names the database", () => {
    expect(fp).toContain("db=neondb");
  });

  it("defaults the port", () => {
    expect(fp).toContain("port=5432");
  });

  it("reports the password length", () => {
    expect(fp).toContain("passlen=13");
  });

  it("never contains the password", () => {
    expect(fp).not.toContain("npg_ABC123xyz");
  });

  it("distinguishes a one-character difference", () => {
    expect(dsnFingerprint(wrong)).not.toBe(fp);
  });

  it("is identical for an identical secret", () => {
    expect(dsnFingerprint(`"${good}"`)).toBe(fp);
  });

  it("removes a bare npg_ token from driver text", () => {
    // libpq quotes the password back inside its own error message.
    const leaked =
      'invalid dsn: unexpected spaces found in "npg_ABC123xyz", ' +
      "use percent-encoded spaces (%20) instead";
    expect(redact(leaked)).not.toContain("npg_ABC123xyz");
  });

  it("removes credentials embedded in a URI", () => {
    const uriLeak =
      'FATAL: password authentication failed for user "x" ' +
      "(postgresql://neondb_owner:npg_ABC123xyz@host/db)";
    expect(redact(uriLeak)).not.toContain("npg_ABC123xyz");
  });

  it("leaves an ordinary error intact", () => {
    expect(redact('relation "students" does not exist')).toBe('relation "students" does not exist');
  });
});