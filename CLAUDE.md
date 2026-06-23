# MagentiQA — Claude Code agent instructions

MagentiQA is a self-hosted verification (test) management platform for ISO 13485 /
FDA design-control workflows. Node.js + Express, a vanilla-JS single-page app, and
a single SQLite database — **no build step, no external services**.

## ⚠️ Keep the docs in sync with the code — but edit them wisely

After any change to the application, consider whether these two docs need to
change, and if so update them **thoughtfully** — never by blindly appending:

1. **`README.md`** — the technical/operator reference. Touches: architecture,
   files, scripts, env vars, the HTTP API, data model, roles, storage, backups.
2. **`USER_GUIDE.md`** — the first-time-user, feature-by-feature walkthrough.
   Touches: anything a *user* notices — new/changed pages, buttons, flows,
   features, or wording.

How to do it well:
- **Judge relevance first.** Not every code change needs a doc edit. A purely
  internal refactor with no behavior change usually needs none; a new
  user-facing feature needs both. Update only what genuinely changed.
- **Edit the document as a whole, not just the diff.** When you do touch a doc,
  re-read the surrounding section (and related ones) and leave it **clear,
  consistent, and non-redundant** — fix now-stale wording, remove anything the
  change made obsolete, and don't bolt on a paragraph that duplicates or
  contradicts existing text. The goal is a doc that reads as if written fresh,
  not one accreting notes.
- **Stay accurate & focused.** Document the actual project, never aspirational or
  removed behavior — verify against the code. Keep each doc to its audience
  (operator vs. end-user) and cut tangents.
- If you add a file/route/script/env var, reflect it in the right place(s) in the
  README (structure, API table, scripts table, env section) — and nowhere it
  doesn't belong.
- Treat "done" as: code changed **and** the docs that should reflect it are
  updated, coherent, and trimmed.

## Project orientation

- `server.js` — Express bootstrap (env, sessions, static files, routes).
- `lib/` — data layer (`db.js`, SQLite via better-sqlite3), `auth.js`, `audit.js`,
  `signature.js`, `pdf.js`, `setups.js`, `backup.js`, parsers under `lib/parsers/`.
- `routes/` — `auth`, `projects`, `tests`, `executions`, `google`, `misc`
  (import/export, **backups**, audit, users, approvals, dashboard, templates).
- `public/` — the SPA: `js/api.js`, `js/app.js`, `js/ui.js`, and one file per page
  under `js/pages/` (dashboard, projects, tests, trackers, import, approvals,
  audit, admin).
- `data/magentiqa.db` — the database (WAL mode). `storage/` — evidence, pdfs,
  imports. `backups/` — `magentiqa-backup_<timestamp>.zip` archives.

## Conventions

- Match the surrounding code style; no transpiler/build — plain Node + vanilla JS.
- All API routes are under `/api` and require a session cookie (except `/api/auth/*`
  and the CI webhook). Admin-only actions use `requireRole('ADMIN')`.
- The DB layer is collection-style (`db.<collection>.findAll/findOne/create/...`);
  data is stored as JSON per row with expression indexes on hot keys.
- Backups are produced by `lib/backup.js` (used by both `POST /api/backup` and
  `npm run backup`) — keep those two paths identical.

## Verify before finishing

- `node --check` any JS file you edit.
- For server/route changes, boot on a spare port (e.g. `PORT=3999 node server.js`)
  and exercise the affected endpoint rather than assuming it works.
- Don't commit/push unless asked.

## Acting as a user — always use `sysadmin`

Whenever you need to act *as a user* against a running app or the database — API
calls, logins, GUI clicks, manual verification, seeding/exercising data — do it as
the seeded **`sysadmin` / `admin123`** account. **Never create throwaway users**
(or other test records you can't account for later): every authenticated action is
written to the immutable audit trail, and the operator must be able to recognize
every entry. `sysadmin` is ADMIN, so it can reach any endpoint you'd need to test.
If a flow genuinely requires a specific role you can't exercise as `sysadmin`, ask
first rather than inventing accounts. Clean up any non-audit test data you create
(test definitions, projects, uploads) when you're done.
