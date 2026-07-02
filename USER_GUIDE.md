# MagentiQA — User Guide

Welcome to **MagentiQA**, a verification (test) management platform built around
ISO 13485 / FDA design-control workflows. This guide walks you through the app
from your first login to producing an audit-ready, electronically-signed report —
no prior knowledge assumed.

If you are setting the server up rather than using it, start with the
[README](README.md); this guide is about *using* the running application.

---

## Table of contents

1. [Key ideas in one minute](#1-key-ideas-in-one-minute)
2. [Logging in](#2-logging-in)
3. [Getting around](#3-getting-around-the-sidebar)
4. [Dashboard](#4-dashboard)
5. [Projects & Versions](#5-projects--versions)
6. [The Verifications library](#6-the-verifications-library)
7. [Setup Trackers](#7-setup-trackers)
8. [Importing verifications](#8-importing-verifications)
9. [Google Drive sync](#9-google-drive-sync-optional)
10. [Running a verification (executions & e-signatures)](#10-running-a-verification)
11. [Evidence](#11-evidence)
12. [Approvals](#12-approvals)
13. [Reports & exports](#13-reports--exports)
14. [Audit trail](#14-audit-trail)
15. [Admin: users & roles](#15-admin-users--roles)
16. [Backups & restore](#16-backups--restore)
17. [CI/CD integration](#17-cicd-integration)
18. [Tips & FAQ](#18-tips--faq)

---

## 1. Key ideas in one minute

MagentiQA organises work in a simple hierarchy:

```
Project  →  Version  →  Verification (in that version)  →  Execution  →  Signature
                                                              └→ Evidence
```

- A **Project** is a product you verify (e.g. "Main Product").
- A **Version** is a release of that product (e.g. `v1.0.0`). A new version
  automatically inherits the previous version's list of verifications, reset to
  *Not Started*.
- A **Verification** (also called a test definition) is a reusable procedure with
  steps. It gets an auto ID like `VT-0001`. It lives in your **Verifications
  library** and can be linked to many versions.
- An **Execution** is one actual run of a verification against a version — you
  mark each step pass/fail, attach evidence, and **electronically sign** it.
- An **Approval** is an authority's **version-level sign-off** certifying the
  whole version's verification report.
- Every meaningful action is written to an immutable **Audit Trail**.

> **Two kinds of verification:** *Standard* (just steps) and *Setup-tracked*
> (also carries a table of "setups" — the different conditions/configurations the
> test must be run under, e.g. hardware combinations). See
> [Setup Trackers](#7-setup-trackers).

---

## 2. Logging in

Open the app in your browser (default **http://localhost:3000**).

- Accounts are created by an administrator — there is no public sign-up. The
  initial admin logs in with the seeded account `sysadmin` / `admin123` (change
  this password in a real deployment, via the account menu → **Change password**).
- To add yourself, ask an admin to **invite** you. You'll receive a one-time link;
  open it, set a password (at least 8 characters), and you're signed straight in.
  See [Users & roles](#15-admin-users--roles).
- Forgot your password? An admin can reset it for you.

Your login persists across server restarts, and the browser **Back/Forward**
buttons work throughout the app. You can change your own password any time from the
account menu (top-right) → **Change password**.

---

## 3. Getting around (the sidebar)

The left sidebar is your main navigation:

| Item | What it's for |
|------|---------------|
| **Dashboard** | Status overview for a chosen version |
| **Projects** | Create/open projects and their versions |
| **Verifications** | The library of all test definitions |
| **Setup Trackers** | Verifications that track multiple setups/conditions |
| **Import** | Bring in verifications from files or Google Drive |
| **Approvals** | Review and approve/reject verification results |
| **Audit Trail** | The immutable history of every action |
| **Admin** | Users, data export, integrations, **backups** |

---

## 4. Dashboard

The Dashboard is your **command center** for one version — built around what to
do next, not just statistics. It greets you by name and notes how much has
changed since your last visit. Pick the **project** and then the **version** from
the two selectors at the top; the tag beside them (e.g. **Draft**, **In
Verification**, **Verified**, **Released**) is that version's *workflow status*,
set from the version's detail page. The Dashboard **remembers your last project
and version** on this device — switch tabs and come back, or restart the app, and
it reopens right where you left off.

**Needs your attention** leads the page — a work queue grouped by what to act on:

- **Continue where you left off** — verifications in progress, with a **Resume**
  button and (for setup-tracked runs) how many setups are done.
- **Investigate failures** and **Unblock** — failed and blocked verifications,
  with **Review** / **Re-execute** actions.
- **Pending approvals** — items awaiting sign-off, linking to the Approvals page.
- **Jump back in** — verifications you recently opened on this device.

If nothing needs action, the queue shows an "all caught up" message.

**Release readiness** sits alongside it: a prominent blue **Coverage** percentage
above a progress bar, then a checklist of **Passed / Failed / Blocked**, topped by
an overall verdict (**Ready for release**, **In progress**, or **At risk**).

These progress figures are **unit-based** — each setup of a setup-tracked
verification is counted on its own ("setup-verification couples"), so its setups
split across passed / failed / blocked rather than collapsing into one *Partial*.
**Coverage** is the share of units with a terminal verdict (**Passed + Failed**),
and the bar shows the passed / failed / blocked / remaining split. (*Partial*
survives only as a setup-tracked verification's rolled-up badge — never as a
count, since every setup is bucketed on its own.)

The **Verifications** table lists the version's tests with **attention items
first** (failed, blocked, in progress, and items pending approval before
completed work). Above it, a compact metric strip doubles as **filters**: click
**Failed**, **In Progress**, etc. to narrow the list, click again or **All** to
clear. Each row has inline **Execute** and **View** buttons after the title; use
**Open in version view** to see the full grouped list with the same filter
applied. **Recent Activity** closes the page.

---

## 5. Projects & Versions

**Create a project:** Projects page → **New Project**. Give it a name and a
**type** (`US_SOFTWARE`, `EU_SOFTWARE`, or `IMAGE_VERSION`).

**Rename a project:** click the pencil icon on a project card → **Edit Project**,
change its **name** (also description and Git repo), and **Save Changes**.

**Open a project** to see its versions. **New Version** creates a release; the new
version copies the previous version's verification list (all reset to *Not
Started*) and its **Default Setup** text, so you don't re-link everything or
re-type the standard setup each release.

Each version card has an **edit** (pencil) button to rename the version, change
its status and edit its default setup, and — for ADMINs — a **delete** button that
removes the version and all of its verification runs (this cascade can't be
undone). The same edits are available from the version page via **Edit version**.

The version page opens with a row of status cards — **Total, Not Started, In
Progress, Blocked, Failed, Passed** — each marked by a coloured left accent (green
passed, red failed, blue in progress, grey not started). These count **execution
units**: a standard verification is one unit, and **each setup of a setup-tracked
verification is counted on its own**, so the totals here match the **Execution
Progress** bar below them exactly. (There is no *Partial* card — a setup that
resolves partially doesn't exist; each setup is individually passed/failed/etc.
*Partial* lives on only as a setup-tracked verification's rolled-up row badge.)
The cards are also **filters**: click one to show only the matching units, and
click it again (or **Total**) to clear. The Execution Progress bar stacks the
statuses into one segmented chart, with a small *“% complete · % passed · %
failed”* label at its left edge (hover any segment for its count).

The **Verifications** list groups tests by tag. A standard verification is a
single row; a **setup-tracked** one is an **expandable parent** — click its
chevron to reveal a nested sub-row per setup, each showing that setup's own status
(draft-aware), who ran it, when, and an **Execute** button that jumps straight to
that setup. Filtering by a status auto-expands the setup-tracked verifications
that contain a matching setup and shows just those setups, so clicking **Blocked**
takes you right to the blocked ones.

**In Progress** and **Blocked** reflect work that's under way but not yet signed:
a unit counts as **In Progress** as soon as someone records a step in an unsigned
run of it, and as **Blocked** if any recorded step is marked *Blocked* (a blocker
outranks in-progress work). Because these come from the shared draft (see
[Running a verification](#10-running-a-verification)), anyone viewing the version
sees them, and they clear the moment that run is signed to a final verdict.

A collapsible **Default Setup** panel sits at the top of the page. This is the
standard test environment and technician-screen configuration that applies to
every verification in the version unless a specific test states otherwise, and is
edited via **Edit version** (see below). On the report's opening page it appears
beneath a fixed introductory paragraph that is present in every report.

From a version you can also:
- **Add verifications** to the version (from the library).
- **Download the PDF report**, **export the report to Drive**, or **export blank
  templates to Drive** — three separate buttons (see [Reports & exports](#13-reports--exports)).
- **Execute** a verification — the button's label tracks its status: **Execute**
  when it hasn't started, **Continue** while it's in progress or blocked, and
  **Re-execute** once it has a finished result. (Click the verification's title at
  any time to view its full content and last results.)
- **Reset** a verification to *Not Started* (the reset icon, shown once it has been
  run): permanently deletes its executions, signatures and uploaded evidence **in
  this version**, returning it to a clean slate. Limited to admins and QA engineers
  and recorded in the audit trail; the library definition and other versions are
  untouched.
- **Unlink** a verification from the version (the unlink icon on its row): it's
  removed from this version, along with its runs here, but stays in the library and
  in other versions.
- **Edit version** — rename the version, set its workflow status, and edit the
  **Default Setup** text. (Renaming a version also renames its PDF report file,
  which is named after the project and version.)

Deleting a project (ADMIN only) cascades to its versions and their executions —
this is logged in the audit trail. Make a [backup](#16-backups--restore) first if
in doubt.

---

## 6. The Verifications library

The **Verifications** page is your reusable catalogue of test definitions,
grouped and searchable. Each definition has:

- An auto ID (`VT-0001`, `VT-0002`, …) that never changes.
- Title, tags, description, preconditions, configuration, files, notes.
- An ordered list of **steps** (action + expected result).
- A **type**: *Standard* or *Setup-tracked*.

Click a verification to **View** its full content, or edit it. You can create
verifications by hand, or [import](#8-importing-verifications) them in bulk.

The same definition can be linked into many versions; editing the definition
updates it everywhere it's used.

**Bulk actions** — tick the checkbox on any rows (or the header checkbox to
select all) and a toolbar appears: **Add to version** or **Remove from version**
(pick the target from a list grouped by project), or **Delete** the selected
definitions. Filtering or searching clears the selection.

---

## 7. Setup Trackers

Some verifications must be performed under many **setups** — distinct conditions
or configurations (for example, different hardware wiring combinations). A
**setup-tracked** verification owns a dynamic table of these setups.

On the **Setup Trackers** page you can:
- **Create a setup-tracked verification** from scratch.
- Edit its setups table. The descriptive columns from your source spreadsheet are
  preserved in order: **Test ID** (the setup's id, e.g. `TEST-HW-001`), any extra
  columns, and **Setup Details**. Clicking **+ Column** under **Setups** adds the
  new column where extra columns belong — between **Test ID** and **Setup Details**.
- The **Status** and **Tester Name** columns are different: they aren't setup
  details you fill in by hand, they're the **outcome** of running the setup — the
  pass/fail verdict and who signed it. Importing a tracker that already has these
  filled in is treated exactly as if a tester had run the setup and signed it.
- See **coverage** at a glance — e.g. "7/10 setups passed" — both as a baseline
  (from the table) and per-version (from executions tagged with a setup).

You can **convert** any verification between *Standard* and *Setup-tracked*. When
running a setup-tracked verification, the tester chooses which setup the run
covers, which feeds the per-version coverage numbers.

---

## 8. Importing verifications

Go to the **Import** page. There are three tabs:

- **Single File** — upload one `.docx`, `.md`, or `.xlsx` file, preview the parsed
  result, then **Save Verification**.
- **Folder** — drag a whole folder; every supported file is parsed at once. **The
  folder structure becomes tags** (e.g. `Features/Login/test.md` → tag `Login`).
  Review the list, then **Import All**.
- **Google Drive** — read documents straight from a Drive folder (see
  [next section](#9-google-drive-sync-optional)).

A progress bar tracks the upload and parsing, so a large file or folder never
looks like a frozen page — wait for it to finish before reviewing the preview.

**Supported formats:**

- **`.md`** — front-matter or `# Title`, optional `## Configuration`, `## Files`,
  `## Description`, `## Pre conditions` sections, and a `## Steps` section with a
  `| # | Action | Expected Result |` table or a numbered list.
- **`.docx`** — a metadata table (`Test: <title>`, plus Configuration / Files /
  Description / Pre conditions rows) and a steps table.
- **`.xlsx`** — a **setup tracker** spreadsheet (see below).

**Re-importing is safe:** a file whose title matches an existing verification
**updates** that definition (keeping its `VT-xxxx` ID) instead of creating a
duplicate.

**Setup trackers (`.xlsx`):** a tracker is linked to its verification by file name
in the same folder — `hardware setup.docx` ↔ `hardware setup test tracker.xlsx`.
On a folder/Drive import the two are paired automatically and the verification
becomes setup-tracked. A tracker imported on its own attaches to (or creates) the
verification of the same base name. Summary rows are ignored; parsing starts at
the table header (found by its `Test ID` column) and **every column is captured**.

---

## 9. Google Drive sync (optional)

If your verifications live as **Google Docs / files in a Drive folder**, MagentiQA
can read them directly — no manual download.

1. Import page → **Google Drive** tab → **Connect Google Drive** (one-time OAuth).
2. Browse to the folder (shared folders, "Shared with me", and shortcuts are
   supported) and **Import**. Need a folder that doesn't exist yet? **New folder**
   in the picker creates one inside the folder you're viewing and steps into it.
3. Native Google Docs are read as structured content; `.docx` and `.xlsx` files in
   Drive are downloaded and run through the same parser as a manual import.
   Subfolder names along each file's path become tags.

**Export the PDF report to Drive** — the **PDF to Drive** button on a version
uploads the version's full PDF report (results + approvals) into a Drive folder
you choose; the picker opens at the configured export folder by default.

**Export templates back to Drive** — the **Templates to Drive** button is the
inverse of import. It writes every verification as a blank `.docx` **template**
(no pass/fail results): its **tags become the nested folders** that contain it,
and setup-tracked verifications also get their `… test tracker.xlsx`. The `.docx`'s
steps and fields are filled in while its Results, Comments and signature fields are
left blank. The tracker keeps your columns in their original order and **fills the
Status and Tester Name columns from how each setup was run** — the pass/fail you
recorded and the name that signed it (blank for setups not yet run). You choose the
destination (it defaults to your import folder); existing files with the same name
are **updated in place**, so re-exporting an unchanged version leaves the folder
identical, while edits and new verifications show up at export time.

> Connecting Drive requires server-side OAuth credentials in `.env`. If the Drive
> tab says it's not configured, ask your administrator — setup steps are in the
> [README](README.md#google-drive-sync-optional).

---

## 10. Running a verification

Executions happen **inside a version**. Open a project → version → click the
verification you want to run.

1. **Record an execution:** the screen is a focused two-column workspace — the
   **test steps** fill the main column, with everything else (setup selector,
   step navigator, and side panels) in the right-hand column. Mark each **step**
   as passed/failed and add any observed results; each step's **expected result**
   is shown as a high-contrast callout so the pass criteria is unmistakable. The
   software version under test is shown automatically (from the version); add a
   **summary** and note any **deviations** in the **Execution Details** panel.
2. For a **setup-tracked** verification, the **Setups in this version** panel at
   the top of the right column is your selector — each entry previews the setup's
   Test ID, details, tester and status; click one to perform it. A setup's status
   reflects what you recorded: a signed **Passed/Failed**, **Blocked** if any step
   is blocked, **Not Tested** if its steps are all not-tested, otherwise **In
   progress** or **Not performed**. (A compact briefing strip under the header
   shows the selected setup's descriptive details — not its status or tester,
   which are the outcome of running it.)
   Each setup is recorded **independently** — your marks for one setup don't carry
   over to another — and is signed on its own.
3. **Review & Sign** the execution. It unlocks only once **every step is Pass or
   Fail**; a step left **Blocked, Not Tested or unmarked** keeps it locked (a
   panel lists what still needs a result). Signing applies your **electronic
   signature** (FDA 21 CFR Part 11 style), shown as the verification's **"Verified
   By"** signature in the report. For a setup-tracked verification it also records
   the setup's outcome — its **Status** column becomes this run's pass/fail verdict
   and its **Tester Name** column becomes your name — which is what reappears in an
   exported tracker.
4. You can **bulk-sign** several executions at once.

Your marks, notes and deviations **autosave continuously** as an in-progress
draft, so you can leave and pick up where you left off. Drafts are **shared**: a
colleague can continue a run you started (and vice versa), and whoever finally
signs is recorded as the performer. Until it's signed, the verification shows as
**In Progress** on the version and dashboard — or **Blocked** if you've marked any
step *Blocked* — so a blocker is visible to the whole team while you sort it out.
Signing turns the draft into the permanent, e-signed execution and clears it.

Each signature is an HMAC over the user, entity, timestamp and meaning, so any
later tampering with the record is detectable. An execution's overall result rolls
up into the version-test status and the dashboard.

---

## 11. Evidence

While recording or viewing an execution you can **attach evidence** — screenshots,
logs, videos, PDFs, etc. Files are stored on the server under
`storage/evidence/<execution>/` and listed on the execution. You can download or
remove evidence files.

> Housekeeping: evidence files that no record references (e.g. an interrupted
> upload) are automatically swept away after a short grace period, so orphaned
> files don't accumulate.

---

## 12. Approvals

Approval is a **version-level sign-off** — an authority certifying that the
version was verified by all the verifications in its report.

- **Requesting:** on a version, click **Request approval**. A request is also
  created **automatically** once the version reaches **100% coverage** — every
  execution **unit** has a terminal verdict (Passed or Failed), which for a
  setup-tracked verification means *every one of its setups*. A version has at most
  one open request; if coverage later drops (including when a fresh in-progress
  draft reopens a unit), an *auto*-request is withdrawn (a manual one is kept).
- **Resolving:** the request appears on the **Approvals** page (and the dashboard
  "Approvals" count / work queue). An **ADMIN** or **APPROVER** can **Approve** or
  **Reject** (optionally with a comment).
- **Approving signs the version.** It records the version's **"Approved By"**
  electronic signature, which fills the report's **Version Approval** box (name,
  date, hash). Each verification keeps its own **"Verified By"** signature from
  when it was executed. (The PDF no longer has a single document-level
  "Prepared By".)

---

## 13. Reports & exports

A version has **three distinct exports** — the buttons appear both on the version
page and on each version card in a project:

- **(A) Download PDF** — the audit-ready PDF for the version: a cover carrying
  the Magentiq Eye logo, summary statistics, a results overview and the version
  approval, followed by the version's **Verification Setup** page (its Default
  Setup text) and then a detail page per verification. Each step's **Pass/Fail** is
  shown per verification; for a **setup-tracked** verification a step is rolled up
  across all its setups — **Pass** if it passed in every setup, **Fail** if it
  failed in every setup, and **Partially Passed** if it passed in some and failed
  in others. The detail page also lists the verification's setups, each with its
  verdict (Passed / Failed / Blocked / Not Started) and tester. Rendered via a
  headless browser, falling back to a self-contained HTML file if none is
  available. This is the report **with** pass/fail results.
- **(B) Export PDF to Drive** — the same PDF report, uploaded to a Google Drive
  folder you choose (the picker opens at the configured export folder by default).
- **(C) Export templates to Drive** — every verification written back to Drive as a
  blank **template** (`.docx`, plus the `.xlsx` tracker for setup-tracked ones)
  with **no** results — for reuse as the canonical source set. See
  [Google Drive sync](#9-google-drive-sync-optional) for details.

The PDF's summary statistics read **Total → Not Started → In Progress → Failed →
Partially Passed → Passed**; **Not Started** and **In Progress** (shown in blue)
appear only when they aren't zero, while the rest always show.

- **All verifications (JSON):** Admin page → **Data Export** downloads the entire
  verification library as JSON for backup or external processing.
- **Single version (JSON):** a full export of one version including its tests,
  executions, step results, signatures and evidence metadata.

---

## 14. Audit trail

The **Audit Trail** page is an immutable, searchable log of every
verification-relevant event: `CREATE`, `UPDATE`, `DELETE`, `EXECUTE`, `SIGN`,
`APPROVE`/`REJECT`, `IMPORT`, `EXPORT`, `LINK`/`UNLINK`. Each entry records the
user, timestamp, IP address, and a before/after diff. Click an entry for full
detail. You can filter by entity, record, or user.

---

## 15. Admin: users & roles

The **Admin** page (visible to all signed-in users, with admin-only actions) shows:

- **Users** — everyone in the system, their role, status (Active/Inactive), and when
  they joined. An **ADMIN** can **Edit Role**, **Reset password**, and
  **Deactivate** / **Reactivate** an account.
- **Pending invites** (appears when any are outstanding) — copy an invite link again,
  or revoke it.
- **Data Export** and **CI/CD** integration info.
- **Backup & Restore** (ADMIN only) — see [next section](#16-backups--restore).

**Inviting a user (ADMIN).** Click **Invite user**, enter their name, username, and
role, and create the invite. You'll get a single-use link (valid 7 days) — copy it
and send it to the person however you like. When they open it and set a password,
their account is created and they're signed in.

**Deactivating a user (ADMIN).** Deactivation blocks sign-in immediately but keeps
the person's signatures and audit history intact (important for traceability) — so
prefer it over deletion when someone leaves. Reactivate to restore access. You can't
deactivate or demote the only remaining active admin.

**Roles:**

| Role | Typically… | Can additionally |
|------|------------|------------------|
| **ADMIN** | The seeded `sysadmin`, or anyone an admin promotes | Everything: invite/deactivate users, change roles, reset passwords, delete projects, resolve approvals, create backups |
| **Approver** | Assigned by admin | Approve/reject approvals |
| **QA Engineer** | Default for invited accounts | Day-to-day work incl. deleting verifications |

Permissions are enforced on the server, and the UI hides buttons you can't use. Every
user-management action (invite, role change, deactivation, password reset) is recorded
in the **Audit Trail**.

---

## 16. Backups & restore

A **backup** is a single timestamped **zip image** of the whole application —
database, all uploaded files, and the full application code — so you can recover
an earlier state after a bad change or a mistake (like a deleted project).

**Create a backup (ADMIN):** Admin page → **Backup & Restore** → **Create
Backup**. The file is written to the server's `backups/` folder, and the list on
that page lets you **Download** any existing backup.

**Optional label:** before clicking Create Backup you can type a short label that
is inserted into the filename, right after `magentiqa-backup`:

- No label → `magentiqa-backup_2026-06-09_15-03.zip`
- Label `updated` → `magentiqa-backup-updated_2026-06-09_15-03.zip`

Labels may contain **lowercase letters, numbers, `-` and `_` only** — no spaces,
capital letters, or other special characters. The input filters disallowed
characters as you type and shows a live filename preview. Two backups made in the
same minute get a numeric suffix, so nothing is ever overwritten.

**What's inside:** a consistent database snapshot (safe to take while people are
using the app), the `storage/` files, all code, and a `BACKUP-MANIFEST.json` with
row counts and metadata.

**To restore (technical):** unzip the archive into a folder, run `npm install`,
then `npm start`. Operators can also create the same archive from the command line
with `npm run backup`.

> **Good habit:** create a backup before importing a large batch, before deleting
> a project or version, and before any code update.

---

## 17. CI/CD integration

Automated pipelines (Jenkins, GitHub Actions, etc.) can push results directly:

```
POST /api/executions/ci
Authorization: Bearer <MAGENTIQA_CI_API_KEY>

{
  "versionTestId": "...",
  "result": "PASSED" | "FAILED",
  "swVersion": "v2.4.1",
  "buildNumber": "204",
  "ciJobUrl": "https://jenkins/...",
  "logs": "optional log output"
}
```

The API key lives in the server's `.env`. The exact `versionTestId` values and the
key are available to admins; see the **CI/CD Integration** card on the Admin page.

---

## 18. Tips & FAQ

- **I deleted something by mistake.** If you have a recent
  [backup](#16-backups--restore), restore from it. Otherwise check the
  [Audit Trail](#14-audit-trail) to see exactly what changed and when.
- **Why didn't my import create a new verification?** A file whose title matches an
  existing one **updates** it (keeping the ID). That's intentional — re-importing
  an edited document refreshes the definition rather than duplicating it.
- **My PDF export came out as HTML.** No headless browser was found on the server;
  the app falls back to a self-contained HTML report. Ask your admin to install
  Chrome/Chromium for true PDFs.
- **Back/Forward buttons** work everywhere — each page has its own URL.
- **Who can do what?** See [Roles](#15-admin-users--roles). If a button is missing,
  your role probably doesn't allow that action.
- **Is anything sent to the cloud?** No, unless you explicitly connect Google
  Drive. All data stays in the local SQLite database and the `storage/` folder.
