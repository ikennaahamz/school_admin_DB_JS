# School Administration System — JavaScript

A rewrite of a CMPE344 (Database Management Systems and Programming II) school
administration system from Python/Streamlit to Next.js 15 and TypeScript,
against the same PostgreSQL schema.

The point of the rewrite is the stack, not new behaviour: the same thirteen
tables, the same eight PL/pgSQL blocks, the same 30 query functions and the same
nine screens, reachable over HTTP with server-side role enforcement.

- **Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4 · `pg`
- **Database:** PostgreSQL 18.6 on Neon (local development uses 17.11)
- **Auth:** bcrypt (via `bcryptjs`) + a signed HTTP-only session cookie
- **Tests:** Vitest (149) · Playwright (47)

---

## Quick start

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and SESSION_SECRET
npm run apply:migrations      # builds the schema and seed data
npm run dev                   # http://localhost:3000
```

All demo accounts use the password `Passw0rd!`:

| Username | Role(s) |
|---|---|
| `admin` | admin |
| `registrar` | registrar |
| `i.kaya` | instructor, CS |
| `i.koc` | instructor, technical |
| `student1`, `student2` | student |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Vitest against the configured database |
| `npm run test:local` | Vitest against `LOCAL_DATABASE_URL` |
| `npm run test:cloud` | Vitest against Neon |
| `npm run test:e2e` | Playwright; builds and starts the app itself |
| `npm run test:all` | Both suites |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / ESLint |
| `npm run check:db` | Can this process reach the database, and what is it? |
| `npm run check-dsn` | Structural diagnosis of a malformed DSN |
| `npm run dsn-fingerprint` | Print a comparable fingerprint of the configured DSN |
| `npm run apply:migrations` | Build the schema and seed data |

## Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Pooled connection, port 5432. What the app uses. |
| `DATABASE_URL_UNPOOLED` | for migrations | Direct connection. DDL and advisory locks must not run through a pooler. |
| `SESSION_SECRET` | yes | `openssl rand -base64 32`. Signs the session cookie. |
| `DB_TARGET` | no | `local` to use `LOCAL_DATABASE_URL`. Defaults to the cloud database. |
| `LOCAL_DATABASE_URL` | no | Local PostgreSQL, for development. |
| `DB_POOL_MAX` | no | Pool size. Defaults to 5. |

`.env` is git-ignored. **No secret is ever read from source**: `lib/db.ts` reads
`process.env` only, so there is no literal to commit. If you need to compare two
connection strings without printing either, use `npm run dsn-fingerprint` — it
prints host, port, database, user, password length and an eight-character
SHA-256 prefix, which is enough to prove two secrets identical and useless for
reconstructing one.

---

## Architecture

```
app/
  (auth)/login/page.tsx        sign in and register
  (app)/layout.tsx             sidebar + session guard
  (app)/<screen>/page.tsx      one directory per screen
lib/
  db.ts                        connections, error translation, actor context
  auth.ts                      bcrypt, roles, requireRole
  session.ts                   signed cookie; no roles stored in it
  guard.ts                     server-side redirects
  nav.ts                       the screen registry: labels, icons, permitted roles
  flash.ts                     one-shot messages
  reports.ts                   the eight analytical queries
  stats.ts                     numeric summaries for report tables
  queries/                     one module per entity, plus lookups
  actions/                     server actions for every write
components/                    DataTable, EntityPicker, Form, Flash, Sidebar
db/migrations/*.sql            the schema, copied verbatim
tests/                         Vitest suites
tests/e2e/                     Playwright suites
scripts/                       operational and diagnostic scripts
```

### The decisions worth knowing about

**The `app.user` actor setting is transaction-scoped.** `trg_audit_grade_change`
records who entered a grade by reading `current_setting('app.user', TRUE)`. The
Python original wrote that session-scoped and was safe only because it opened a
fresh connection per operation. This uses a pool, so `set_config(..., true)` is
discarded at COMMIT instead. It is also reset on every new connection, because
the provider's pooler reuses server sessions between clients — otherwise one
session-scoped write from any other process would be picked up in place of
`CURRENT_USER`. `tests/actor.test.ts` pins this, and was used to justify the
change: flipping the third argument back to `false` makes exactly one of its
four assertions fail.

**The session cookie holds only a signed user id.** Not the roles. Embedding
them would avoid a round trip, but `requireRole()` reads `user.roles`, so a role
baked into a cookie stays in force until it expires — an administrator who
revokes a role has not revoked anything. Re-reading costs one indexed join and
makes revocation immediate.

**Role gating is enforced on the server.** `redirect()` runs before any of a
page's queries. A student who types `/admin` gets a 307 to `/dashboard` without
the database ever being asked. The Streamlit original decided only what to draw,
and said so in its own docstring.

**The Python login timing defence was corrected, not copied.** `auth.py` spent
the miss path with `verify_password(password, hash_password("decoy"))`,
discarding the result — one hash plus one compare, where a real login is one
compare. Measured at cost 12:

| Path | Cost |
|---|---|
| user exists | 544 ms |
| user missing, as Python wrote it | 1220 ms |
| user missing, one constant decoy digest | 610 ms |

The "no such user" branch was about 2.2× slower than the branch it was meant to
be indistinguishable from, which hands an attacker the very signal the code was
written to remove.

**bcryptjs blocks the event loop.** A cost-12 verify is ~600 ms of CPU, not I/O,
so it cannot be interleaved with other work — concurrent sign-ins on one instance
serialise. That is a deployment property, not just a test one.

**No ORM.** Prisma, TypeORM and Drizzle were all rejected. The triggers, the
`FOR UPDATE` in `enroll_student`, and the denormalised `enrolled_count` are the
graded artefacts, and an ORM hides them. Raw SQL throughout.

**No ORM-generated migrations.** `db/migrations/` is copied byte-for-byte from
the Python project's `supabase/` directory, and `.gitattributes` pins line
endings so a clone on Windows cannot drift from it.

**`technical` is a real role that no screen references.** It is seeded and has an
access level, but appears in no screen's permitted-roles list — so a user whose
only role is `technical` sees the Dashboard and nothing else. This is faithful to
the Python app, where `i.koc` reaches the teaching screens through the
`instructor` role they also hold. It is recorded in `tests/nav.test.ts` rather
than papered over.

---

## Testing

```bash
npm test          # 149 assertions, Vitest
npm run test:e2e  # 47 assertions, Playwright
```

The Vitest suite covers the database layer, configuration and DSN handling,
authentication, sessions, the query layer, navigation and role gating, and a
parity test for `hardening.sql`. It runs against either database:

```bash
npm run test:local   # PostgreSQL 17.11
npm run test:cloud   # Neon 18.6
```

The Playwright suite is the port of the Python `app_test.py`, which drove the
Streamlit app headlessly. Next.js has no equivalent in-process harness — a page
is server-rendered behind an HTTP request — so it drives a real browser. It signs
in once per role and reuses the cookie, because bcrypt blocking the event loop
made forty parallel logins look like a hung server.

It uses the installed Chrome (`channel: "chrome"`). On a machine without Chrome,
run `npx playwright install chromium` and remove that line from
`playwright.config.ts`.

## Deployment

Vercel, against Neon. Set `DATABASE_URL` and `SESSION_SECRET` in the project's
environment settings; leave `DATABASE_URL_UNPOOLED` unset unless you run
migrations from CI. `SESSION_SECRET` must be stable across deploys — changing it
invalidates every session, which is the intended behaviour when rotating it.

One caveat worth stating: bcryptjs costs ~600 ms of CPU per sign-in and blocks
the event loop while it runs, so a low-cost serverless instance will feel it.
The session cookie is stateless and signed, so there is no server-side session
store to scale.

## Known limitations

- `db/migrations/verify_plpgsql.sql` is **not idempotent**. Section 7b runs
  `CALL enroll_student(4, 3)` and then deletes the row unconditionally, so
  re-running it against a database that already has that enrolment removes a
  genuine one. Use a scratch database.
- `createUser` and `auth.register` write the user and the role in two separate
  transactions, so a failure between them orphans an account with no role. This
  is faithful to the Python original; fixing it needs a client-scoped
  transaction helper in `lib/db.ts`.
- Neon connectivity is intermittent from some networks. `npm run check:db` will
  tell you whether the fault is the port or the credential — a wrong password
  fails fast, a blocked port times out.
