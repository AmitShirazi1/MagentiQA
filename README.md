# MagentiQA — Verification Management Platform

MagentiQA is a lightweight, self-hosted verification (test) management system designed
around **ISO 13485 / FDA 21 CFR Part 820** design-control workflows. It tracks
verification definitions, runs them against product versions, records electronically
signed executions with evidence, and produces audit-ready PDF reports.

Everything runs locally with **zero external services** — the only storage is a
single SQLite file on disk plus regular folders for uploaded files.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create the demo user + sample data (safe to re-run; skips existing records)
npm run seed

# 3. Start the server
npm start
```

Open **http://localhost:3000** and log in with:
- Username: `sysadmin`
- Password: `admin123`

> **New to the app?** See **[USER_GUIDE.md](USER_GUIDE.md)** for a step-by-step,
> feature-by-feature walkthrough written for first-time users. This README is the
> technical/operator reference.

## Core Concepts & Data Model

```
Project ──< Version ──< VersionTest >── TestDefinition ──< TestStep
                            │                   └──< Setup   (setup-tracked tests only)
                            ├──< Execution ──< StepResult
                            │        ├──< Signature   (HMAC-signed e-signature)
                            │        └──< Evidence    (uploaded files)
                            └──< Approval
AuditLog  (immutable trail of every CREATE/UPDATE/DELETE/EXECUTE/SIGN/IMPORT/EXPORT)
```

| Entity | Meaning |
|--------|---------|
| **Project** | A product under verification (e.g. "Main Product"). Has a type (`US_SOFTWARE`, `EU_SOFTWARE`, `IMAGE_VERSION`). |
| **Version** | A release of a project (e.g. `v1.0.0`). New versions automatically inherit the test list of the previous version, reset to `NOT_STARTED`. |
| **TestDefinition** | A reusable verification ("Verifications Library"): title, auto-assigned ID (`VT-0001`…), tags, description, preconditions, configuration, and ordered steps. Has a `type`: **`STANDARD`** (the default) or **`SETUP_TRACKED`** (additionally owns a dynamic setups table — see Setup). |
| **Setup** | One condition/configuration a **setup-tracked** verification must be performed under (e.g. a hardware wiring combination). Carries a serial id (`TEST-HW-001`) and its descriptive columns (Setup Details + any extra columns) as `data`. Its `status` (the pass/fail verdict) and `testerName` (who signed it) are recorded outcomes, **not** part of `data` — set when a setup is run & signed (or seeded from the imported spreadsheet) and re-created as the `Status` / `Tester Name` columns on export. Coverage ("7/10 setups passed") is shown per definition (baseline) and per version (from executions tagged with a `setupId`). |
| **VersionTest** | Links a test definition to a version and carries the per-version status (`NOT_STARTED`, `IN_PROGRESS`, `PASSED`, `FAILED`, `BLOCKED`) and workflow state (`DRAFT`, `IN_REVIEW`, `APPROVED`). |
| **Execution** | One run of a version-test: overall result, per-step results, SW version/build, environment, summary, deviations. Automatically e-signed as `EXECUTED` by the executor. |
| **Signature** | FDA 21 CFR Part 11-style electronic signature: HMAC-SHA256 over `userId:entityId:timestamp:meaning` (`EXECUTED` / `REVIEWED` / `APPROVED`). Signs an **execution** (the per-verification "Verified By", auto-created on Review & Sign) or a **version** (the report's "Approved By"). Tampering is detectable via verify. |
| **Evidence** | Files (screenshots, logs, videos, PDFs) attached to an execution; stored under `storage/evidence/<executionId>/`. |
| **Approval** | A **version-level** sign-off request (`scope: 'VERSION'`). Requested manually, or automatically once the version reaches 100% coverage (every verification has a terminal verdict — Passed/Failed/Partial). An ADMIN/APPROVER resolving it as `APPROVED` writes the version's `APPROVED` signature (the report's "Approved By"); regressing below 100% withdraws an auto-request. (Legacy per-version-test approvals are still supported.) |
| **AuditLog** | Immutable record of every verification-relevant event with user, timestamp, IP, and before/after diff (viewable in the Audit Trail page). |

## Application Structure

```
server.js               Express bootstrap: .env loading, sessions, static files, routes
lib/
  env.js                Minimal .env loader (no dependency)
  db.js                 SQLite data layer (better-sqlite3) — collection-style API
  session-store.js      SQLite-backed express-session store (logins survive restarts)
  auth.js               Session auth, bcrypt password hashing, role helpers
  audit.js              Audit-trail writer (filters to verification-relevant events)
  signature.js          HMAC-SHA256 electronic signatures (sign / verify)
  cleanup.js            Startup + daily sweeps: orphan evidence files + dangling version-test links
  pdf.js                Verification report generator (Puppeteer → PDF, HTML fallback)
  setups.js             Shared replace-on-save persistence for a tracked test's setups
  backup.js             Full snapshot (consistent DB + storage + all code) → backups/*.zip
  google.js             Drive/Docs client (OAuth, list, download, folder/file upsert)
  verification-doc.js          Clean .docx template generator (inverse of parsers/docx.js)
  verification-tracker-xlsx.js Clean .xlsx tracker generator (inverse of parsers/xlsx.js)
  templates/
    verification-template.docx Styling skeleton reused when generating .docx
  parsers/
    docx.js             .docx test importer (mammoth → table extraction)
    markdown.js         .md test importer (front-matter + ## sections + step tables)
    xlsx.js             .xlsx "test tracker" importer (jszip → dynamic setups table)
    tracker-link.js     Names a docx ↔ its "… test tracker.xlsx" for import pairing
routes/
  auth.js               POST /api/auth/{login,register,logout}, GET /api/auth/me
  projects.js           Projects & versions CRUD (+ test inheritance, cascade delete)
  tests.js              Test definitions CRUD + version-test linking
  executions.js         Executions, step results, signatures, evidence upload, CI webhook
  google.js             Drive sync (import), report upload, version export to Drive
  misc.js               Import (.docx/.md), exports (PDF/JSON), backups, audit, users,
                        approvals, dashboard stats, templates
public/                 Single-page app (vanilla JS, no build step)
  index.html            Shell: login screen, sidebar, page containers, modal, toasts
  js/api.js             Fetch wrapper for all API calls
  js/app.js             Bootstrap, auth, History-API navigation (Back/Forward works)
  js/ui.js              Shared UI helpers (toast, modal, badges, theming)
  js/pages/*.js         One file per page: dashboard, projects, tests, trackers,
                        import, approvals, audit, admin
scripts/
  seed.js               Demo user + sample project/version
  backup.js             CLI wrapper around lib/backup.js (npm run backup)
data/
  magentiqa.db          THE database (SQLite, WAL mode)
  legacy-json/          Pre-migration JSON files, kept as a backup
storage/
  evidence/             Uploaded evidence files (per execution)
  pdfs/                 Generated verification reports
  imports/              Raw uploaded .docx/.md files
backups/                Backup archives (magentiqa-backup_<timestamp>.zip)
```

## Storage

All structured data lives in **`data/magentiqa.db`** — a single SQLite database
(WAL mode, synchronous writes). Each collection is a table of
`(id, json data)` with expression indexes on the hot lookup keys
(`versionTestId`, `executionId`, `entity`, `createdAt`, …), so executions and
audit logs can grow into the millions of rows without performance loss — filtering,
sorting and pagination all run inside SQLite instead of loading whole files into memory.

> **History:** earlier versions stored each collection as one big JSON file in
> `data/*.json` and rewrote the entire file on every change. On first start after
> the upgrade, those files are imported automatically and moved to
> `data/legacy-json/` as a backup. No action needed.

Binary files (evidence, PDFs, import sources) stay as plain files under `storage/`.
A housekeeping sweep runs at startup and daily: evidence files that no database
record references (interrupted uploads, externally deleted records) are removed
after a one-hour grace period.

### Backup ("bullet-proofing" the data)

A backup is a single timestamped **zip image** of the whole application, written
to the `backups/` folder. It contains everything needed to restore an old state
after a bad code change or a user mistake (e.g. a deleted project):

- **`data/magentiqa.db`** — a consistent SQLite snapshot taken via the
  online-backup API, so it is safe even while the server is running (pending WAL
  writes are folded in; no separate `-wal`/`-shm` files needed).
- **`storage/`** — all uploaded evidence, generated PDFs and import sources.
- **All application code** — `lib/`, `routes/`, `public/`, `scripts/`,
  `server.js`, `package.json`, `.env`, docs, etc. (`node_modules/`, `backups/`
  and `.git/` are excluded — reproducible or irrelevant).
- **`BACKUP-MANIFEST.json`** — created-at, author, Node/platform and table row
  counts for a quick sanity check of what's inside.

**Two ways to create one — both produce an identical archive:**

```bash
npm run backup          # CLI
```

or, in the app, **Admin → Backup & Restore → Create Backup** (ADMIN role only).
Existing backups are listed there with their size/date and a **Download** link.

**Filename format:** `magentiqa-backup_YYYY-MM-dd_HH-mm.zip`. You may add an
optional label that is inserted after `magentiqa-backup` and before the
timestamp — e.g. label `updated` → `magentiqa-backup-updated_YYYY-MM-dd_HH-mm.zip`.
Labels may contain **lowercase letters, digits, `-` and `_` only** (no spaces,
capitals or other characters); invalid labels are rejected. Same-minute backups
get a numeric suffix so nothing is ever overwritten.

**To restore:** unzip the archive into a folder, run `npm install`, then
`npm start`. **Use a backup instead of copying folders by hand.**

## HTTP API Overview

All routes are under `/api` and require a session cookie (log in first), except
`/api/auth/*` and the CI webhook.

| Area | Endpoints |
|------|-----------|
| Auth | `POST /auth/login` · `POST /auth/register` (first account = ADMIN, later = QA_ENGINEER) · `POST /auth/logout` · `GET /auth/me` |
| Projects | `GET/POST /projects` · `GET/PUT/DELETE /projects/:id` |
| Versions | `GET/POST /projects/:pid/versions` · `GET/PUT /projects/:pid/versions/:vid` |
| Tests | `GET/POST /tests` · `GET/PUT/DELETE /tests/:id` · `POST /tests/:id/convert` (STANDARD ↔ SETUP_TRACKED) |
| Version-tests | `GET/POST /tests/version/:vid` · `PUT/DELETE /tests/version/:vid/:vtId` |
| Executions | `GET/POST /executions` · `GET /executions/:id` · `POST /executions/:id/sign` · `POST /executions/bulk-sign` · `GET /executions/:id/verify` |
| Evidence | `GET/POST /executions/:id/evidence` · `GET .../:evId/download` · `DELETE .../:evId` |
| Import | `POST /import/preview` · `POST /import/folder` · `POST /import/save` · `POST /import/save-batch` |
| Export | `GET /export/report/:vid` (PDF) · `GET /export/tests` · `GET /export/version/:vid` |
| Backup | `POST /backup` (ADMIN, optional `{ label }`) · `GET /backups` · `GET /backups/:name/download` |
| Misc | `GET /audit` · `GET /audit/:id` · `GET /users` · `PUT /users/:id` · `GET/POST/PUT /approvals` (version sign-off: `POST {scope:'VERSION',versionId}`) · `GET /dashboard/:vid` · `GET/POST /templates` |
| Google Drive | `GET /google/status` · `GET /google/folders` · `POST /google/sync` (import) · `POST /google/upload-report` (PDF) · `POST /google/export-version` (verifications → Drive) |
| CI | `POST /executions/ci` (API-key auth, see below) |

### CI/CD Webhook

Push automated results from Jenkins or any CI:

```
POST /api/executions/ci
Authorization: Bearer <MAGENTIQA_CI_API_KEY>

{
  "versionTestId": "...",
  "result": "PASSED" | "FAILED",
  "swVersion": "v2.4.1",
  "buildNumber": "204",
  "ciJobUrl": "https://jenkins/...",
  "logs": "optional log output (first 2000 chars stored)"
}
```

## Importing Verifications

- **Single file** or **whole folder** (drag & drop) of `.docx` / `.md` / `.xlsx` files.
- Folder structure becomes tags: `Features/Login/test.md` → tag `Login`.
- `.md` format: front-matter or `# Title`, optional `## Configuration`,
  `## Files`, `## Description`, `## Pre conditions` sections, and a `## Steps`
  section containing a `| # | Action | Expected Result |` table or a numbered list.
- `.docx` format: a metadata table (`Test: <title>`, Configuration / Files /
  Description / Pre conditions rows) plus a steps table
  (`# | Test | Expected Results | …`).
- Re-importing a file with the same title **updates** the existing definition
  (keeping its `VT-xxxx` ID) instead of duplicating it.

### Setup trackers (`.xlsx`)

Some verifications are accompanied by a **setup tracker** spreadsheet that lists
every setup/condition the test must be performed under. The link is by file name
in the same folder: `hardware setup.docx` ↔ `hardware setup test tracker.xlsx`.

- On a folder/Drive import the tracker is **paired** with its verification, which
  becomes a **setup-tracked** test owning the tracker's table; a tracker imported
  on its own attaches to (or creates) the verification of the same base name.
- The spreadsheet's summary rows are ignored; parsing starts at the table header
  (located by its `Test ID` column). **Every descriptive column is captured
  dynamically** (Test ID, any extra columns, Setup Details) — no data is lost
  regardless of the document. The `Status` and `Tester Name` columns are treated
  as runtime outcomes rather than setup data: their values seed the setup's
  verdict and signer (exactly as if a tester had run & signed it in-app), and are
  re-created as columns on export — not shown in the execution briefing.
- Setup-tracked verifications live in the **Setup Trackers** page and show coverage
  ("7/10 setups passed"). You can create them by hand, edit columns/rows, and
  **convert** any verification to/from setup-tracked. A new column added under
  **Setups** lands between the `Test ID` column and `Setup Details` (where extra
  columns belong). During execution a tester can pick which setup a run covers,
  feeding per-version coverage.

## Google Drive Sync (optional)

If your verification source-of-truth lives as **Google Docs in a Drive folder**,
the app can read them directly — no export to `.docx`, no manual download:

```
Sync:   Drive API lists the folder recursively → native Google Docs are read as
        structured JSON (Docs API); .docx files stored in Drive are downloaded
        and run through the same parser as a manual .docx import; .xlsx setup
        trackers are downloaded, parsed and paired with their verification — the
        same preview/save flow as a folder import. Subfolder names along a file's
        path become its tags (Features/Login/MyTest → tag "Login").
        Shared folders and shortcuts are supported: shortcuts resolve to their
        targets, and the folder browser has a "Shared with me" entry.
Upload: generate a version PDF report → push it back into the Drive folder
        (Drive files.create) — "PDF → Drive" button on every version
Export: "Export to Drive" on a version writes every verification back as a
        .docx — the exact inverse of import: a verification's tags become the
        nested subfolders containing it, and setup-tracked verifications also get
        their "<base> test tracker.xlsx". The tracker preserves the original
        column order and re-creates the `Status` and `Tester Name` columns from
        each setup's recorded verdict and signer (blank for setups not yet run);
        the .docx's Result/Comment/Signature fields are left blank. Files are
        upserted (an existing same-name file in the same subfolder is updated in
        place), so re-exporting an unchanged version reproduces the original
        folder. The folder picker defaults to GOOGLE_IMPORT_FOLDER. All exported
        file and folder names are lowercased; the file stem follows the import
        filename when known (recorded as `sourceFile`), else the title. Generated
        trackers place the column headers on row 8 (setup rows from row 9),
        matching the source layout.
```

Tokens are stored locally in `data/google-tokens.json`; the only network calls
are to Google's APIs, made with native `fetch` (no SDK dependency).

**One-time setup:**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **Google Drive API** and **Google Docs API**.
3. **OAuth consent screen** → choose **Internal** (Workspace accounts — no
   verification, tokens don't expire) or **External** in *Testing* mode + add
   yourself as a test user (note: testing-mode refresh tokens expire after 7 days,
   so prefer Internal or publish the app).
4. **Credentials → Create Credentials → OAuth client ID** → type **Desktop app**.
5. Put the client ID/secret in `.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```
6. Restart the server → **Import page → Google Drive tab → Connect Google Drive**.

Scopes requested: `drive` (list the folder, upload reports, and write
verification templates + folders into it) and `documents.readonly` (read Doc
content).

## Environment Variables

Copy `.env.example` to `.env`:

```
PORT=3000
SESSION_SECRET=your_long_random_string     # cookie signing
SIGNATURE_SECRET=another_long_random_string # e-signature HMAC key — don't change
                                            # after signatures exist, or verification
                                            # of old signatures will fail
MAGENTIQA_CI_API_KEY=ci_api_key             # CI webhook auth (legacy VMS_CI_API_KEY
                                            # still honored)
GOOGLE_CLIENT_ID=…                          # optional — Google Drive sync
GOOGLE_CLIENT_SECRET=…                      #   (see "Google Drive Sync" above)
GOOGLE_IMPORT_FOLDER=…                      # optional — Drive folder (URL or ID) the
                                            #   import folder picker opens at by default
GOOGLE_EXPORT_FOLDER=…                      # optional — Drive folder (URL or ID) the
                                            #   PDF-report export picker opens at by default
```

The `.env` file is loaded automatically at startup (`lib/env.js`).

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server |
| `npm run seed` | Seed demo data (idempotent) |
| `npm run backup` | Snapshot DB + storage + code into `backups/magentiqa-backup_<timestamp>.zip` (same as the Admin → Backup button) |

## Tech Stack

- **Runtime**: Node.js ≥ 18 + Express 4 — no build step, no transpiler
- **Database**: SQLite via `better-sqlite3` (WAL mode, single file `data/magentiqa.db`)
- **Sessions**: `express-session` with a SQLite store — logins survive restarts
- **Auth**: bcryptjs password hashing; roles: ADMIN, QA_ENGINEER, REVIEWER, APPROVER, DEVELOPER
- **File parsing**: mammoth (`.docx`), gray-matter (`.md`), jszip (`.xlsx` trackers)
- **PDF reports**: puppeteer-core driving an installed Chrome/Chromium
  (falls back to a self-contained HTML file if no browser is found)
- **Frontend**: vanilla JS SPA with hash routing (`#/page?params`) and full
  browser Back/Forward support

## Roles & Authorization

| Role | Granted to | Can additionally… |
|------|-----------|-------------------|
| `ADMIN` | First registered account | Everything: change user roles, delete projects, resolve approvals |
| `QA_ENGINEER` | Every later registration (default) | Full day-to-day work incl. deleting test definitions |
| `APPROVER` | Assigned by an admin | Resolve (approve/reject) approvals |
| `REVIEWER` / `DEVELOPER` | Assigned by an admin | Standard authenticated access |

Enforced server-side: `PUT /api/users/:id` (ADMIN), `DELETE /api/projects/:id`
(ADMIN), `PUT /api/approvals/:id` (ADMIN/APPROVER), `DELETE /api/tests/:id`
(ADMIN/QA_ENGINEER). The UI hides the corresponding buttons for other roles.

## Security Notes (current posture)

- Designed for **trusted internal networks**. The server binds HTTP (no TLS);
  put it behind a reverse proxy with HTTPS for anything beyond localhost and set
  `cookie.secure = true` in `server.js`.
- Self-registration is open (anyone reaching the server can create a
  QA_ENGINEER account). Remove the register route in `routes/auth.js` if you
  want admin-provisioned accounts only.
- Dependencies are kept minimal (9 runtime packages) and `npm audit` clean.
