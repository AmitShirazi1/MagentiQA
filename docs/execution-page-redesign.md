# Verification Execution — Redesign Spec

**Page:** `renderTestExecute()` → `#page-test-execute` (`public/js/pages/tests.js`)
**Goal:** turn a database-style form into a **Verification Workspace** optimised for executing steps, recording results, capturing evidence, and signing — fast, clear, and audit-ready.

This document is the design contract: wireframe, component hierarchy, section responsibilities, and the rationale behind each major decision. It is written against the *existing* data contract (no backend changes).

---

## 1. Design principles

1. **The step is the unit of work.** Everything else (setup, preconditions, metadata) is reference material that supports executing steps. Steps get the screen; reference material gets cards and a collapsible panel.
2. **One click to record a result.** A QA engineer records N results per test, repeatedly. The control must be a single click — segmented status buttons, never a dropdown.
3. **Always know where you are.** A sticky header keeps identity + progress on screen at all times; a step navigator gives instant jump-to + at-a-glance status.
4. **Compact by default, expandable on demand.** Most steps need no note and no evidence. Those affordances are one click away but cost zero vertical space until used.
5. **Signing is a deliberate, reviewable act.** It produces part of the formal quality record, so it happens through a review panel — not a buried `<select>` + button.
6. **Color is meaning, used sparingly.** Magenta = primary action / focus / progress. Green/red/amber = pass/fail/blocked accents on the *left edge* of step cards only. No color floods.

---

## 2. Data contract (unchanged — must be preserved)

| Concern | Source / Sink |
|---|---|
| Test definition | `vt.test`: `testId, title, path, tags[], type, configuration, files, description, preconditions, notes, steps[]` |
| Steps | `step = {id, order, action, expectedResult}` |
| Setup-tracked data | `test.setupColumns[]`, `test.setups[] = {setupId, status, testerName, data{}}` |
| Create execution | `POST /api/executions {versionTestId, result, swVersion, environment, summary, deviations, stepResults[], setupId}` |
| Step result | `{stepId, result, actual, comment}` — `result` stored verbatim |
| Evidence | `POST /api/executions/:id/evidence` (FormData, after create); model has `description` (no `stepId`) |
| Tester | `currentUser.name` |
| Signature | server auto-signs `EXECUTED` on create |

**Step-result value mapping** (4 buttons → stored values, chosen for compatibility — PDF special-cases only `PASS`/`FAIL`):

| Button | Stored `result` | Card accent |
|---|---|---|
| Pass | `PASS` | green |
| Fail | `FAIL` | red |
| Blocked | `BLOCKED` | amber |
| Not Tested | `NOT_TESTED` | neutral (default state) |

Per-step **evidence** is uploaded to the execution after create, with `description = "Step N — <action excerpt>"`, preserving step attribution within the existing schema. General (non-step) evidence keeps an empty/explicit description.

**Overall result** auto-derives from step results (tester can override at sign time): any `FAIL` → `FAILED`; else any `BLOCKED` → `BLOCKED`; else all steps recorded & all `PASS` → `PASSED`; else `IN_PROGRESS`.

---

## 3. Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ◀ Back to version                                          (compact breadcrumb)│  ← STICKY HEADER
│ ┌──────────────┐                                                              │     (.exec-header
│ │ VR-014  ▸ ●  │  Logo + Version Appearance        [ Tester: A. Smith ]       │      position:sticky
│ │ In Progress  │                                   [ SW: ____ ][ Env: ____ ]  │      top:0, z-index)
│ └──────────────┘                                         [ Review & Sign ▸ ]  │
│ ───────────────────────────────────────────────────────────────────────────  │
│ ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  7/12 recorded   ● 5 Pass  ● 1 Fail  ● 1 Blocked  5 left  │
└─────────────────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────┬───────────────────────────────┐
│ MAIN COLUMN (1fr)                              │ SIDE PANEL (300px, collapsible)│
│                                                │                               │
│ ┌─ Setup Briefing ──────────────────────────┐ │ ┌─ Step Navigator (sticky) ──┐ │
│ │ [setup picker ▾  — setup-tracked only]    │ │ │ ① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ …      │ │
│ │  System        │ Resolution               │ │ │ (chips colored by status, │ │
│ │  Refresh rate  │ Cables                   │ │ │  click → scroll to step)  │ │
│ │  SW version    │ Tester / Environment     │ │ └───────────────────────────┘ │
│ └───────────────────────────────────────────┘ │ ┌─ Execution Details ▾ ──────┐ │
│ ┌─ ⓘ Preconditions ─────────────────────────┐ │ │ Summary / Conclusion       │ │
│ │  Highlighted instruction panel            │ │ │ Deviations / Comments      │ │
│ └───────────────────────────────────────────┘ │ └───────────────────────────┘ │
│                                                │ ┌─ Evidence ▾ ───────────────┐ │
│ STEP CARDS                                     │ │ general drop-zone + list   │ │
│ ┌─[│green]─ Step 1 ─────────────────────────┐ │ └───────────────────────────┘ │
│ │  ACTION  (dominant, 14px)                 │ │ ┌─ History ▾ ────────────────┐ │
│ │  ┌ Expected result (criteria block) ────┐ │ │ │ prior executions           │ │
│ │  └───────────────────────────────────────┘ │ └───────────────────────────┘ │
│ │  [ Pass ][ Fail ][ Blocked ][ Not Tested ]│ │                               │
│ │  + Note     + Evidence                    │ │                               │
│ │  └ note textarea (expand) ───────────────┐ │                               │
│ │  └ evidence dropzone + thumbs (expand) ──┐ │                               │
│ └───────────────────────────────────────────┘ │                               │
│ ┌─[│  ]─ Step 2 … ──────────────────────────┐ │                               │
│                                                │                               │
│ ┌─ ✓ Completion Panel (appears when all      │                               │
│ │   steps recorded) ─ stats, failures,       │                               │
│ │   deviations, evidence count, [Review&Sign]│                               │
│ └───────────────────────────────────────────┘ │                               │
└───────────────────────────────────────────────┴───────────────────────────────┘

REVIEW & SIGN  (modal) — pass/fail/blocked stats · outstanding issues · tester ·
                          sw/env · overall-result selector · ✍ Sign & Submit
```

Responsive: at ≤1100px the side panel drops below the main column (reuses the existing `#exec-layout` breakpoint); the step navigator becomes a horizontal strip.

---

## 4. Component hierarchy

```
renderTestExecute(params)
│
├── execHeader()                         .exec-header  (sticky)
│   ├── back link / breadcrumb
│   ├── identity: testId chip · title · status badge
│   ├── context: tester (read-only) · SW version input · Environment input
│   ├── primary action: "Review & Sign"  → openReviewAndSign()
│   └── execProgressBar()                 segmented bar + counter pills  [id=exec-progress]
│
├── main column
│   ├── setupBriefing()                   .briefing-card
│   │   └── (setup-tracked) setup <select> → onSetupChange() re-renders briefing grid
│   ├── preconditionsPanel()              .precond-panel (ⓘ icon, highlighted)
│   ├── #exec-steps
│   │   └── stepCard(step, i)  × N         .step-card[data-step-id][id=step-card-i]
│   │       ├── num badge · action (dominant)
│   │       ├── expected-result criteria block
│   │       ├── statusButtons()           4 × .step-status-btn  → setStepResult()
│   │       ├── toggles: + Note / + Evidence
│   │       ├── note textarea (collapsed)
│   │       └── per-step evidence dropzone + thumbs (collapsed)
│   └── #exec-completion                  .completion-panel (hidden until complete)
│
└── side panel  (#exec-side, collapsible groups)
    ├── stepNavigator()                   .step-nav (sticky) chips → scrollToStep()
    ├── Execution Details (summary, deviations)
    ├── general Evidence (dropzone + list)
    └── Execution History (prior runs)

State (module-level, this file):
  _exec = { stepState: {stepId:{result, actual, evidence:[File]}}, generalEvidence:[File],
            steps, setups, setupColumns, ids:{vtId,versionId,projectId}, vt }

Behaviour functions:
  setStepResult(stepId,result)  toggleStepNotes(i)  toggleStepEvidence(i)
  addStepEvidence(i,files)       removeStepEvidence(i,idx)
  onSetupChange()                updateExecProgress()      scrollToStep(i)
  deriveOverallResult()          openReviewAndSign()       submitExecution(...)
  toggleSidePanel()  collapseGroup(...)
```

---

## 5. Section responsibilities & rationale

### 5.1 Sticky Execution Header (`.exec-header`)
**Shows:** test ID, title, status, tester, SW version, environment, progress bar + counters, primary action.
**Why sticky:** during a long scroll through 20+ steps the tester must never lose (a) which test this is — audit discipline — or (b) how much is left. Progress + identity are the two facts that justify permanent screen real-estate.
**Why SW/Env live here as inputs:** they are execution context the tester sets once and that belongs to *every* recorded result; keeping them in the always-visible header (single source of truth) prevents the "scrolled past the metadata form and forgot to fill it" failure mode of the old layout. Tester is read-only (`currentUser`) — it is identity, not input.
**Counters** use the established status colors as dots (not flood fills) and tabular numerals, matching the KPI/badge language already in the system.

### 5.2 Setup Briefing card (`.briefing-card`)
**Replaces:** the old setup `<select>` + free-text detail dump.
**Shows:** a clean two-column labeled grid — System, Resolution, Refresh rate, Cables, SW version, Tester, Environment (setup-tracked tests map these from `setup.data`; standard tests fall back to Configuration / Files / Description).
**Why a briefing:** before touching a step the tester confirms the rig is correct. Labeled, scannable value pairs read like a mission briefing — far faster to verify than prose blocks. For setup-tracked tests the picker swaps the whole grid so the tester sees the *complete* wiring of the exact condition under test.
**Rationale for two columns:** pairs related facts (resolution↔refresh, cables↔system) and halves vertical space vs. the old stacked field list.

### 5.3 Preconditions panel (`.precond-panel`)
**Shows:** preconditions as a highlighted instruction card with an info icon and generous typography.
**Why elevated:** preconditions are gating conditions — if they are not met the execution is invalid. They must visually outrank ordinary copy. An `--info`-tinted left border + icon signals "read me before you start" without shouting.

### 5.4 Step cards (`.step-card`) — the core
**Replaces:** the horizontal 5-column table.
**Each card:** number badge → **Action** (visually dominant, the verb the tester performs) → **Expected result** (a distinct, boxed "verification criteria" block) → 4 status buttons → optional note → optional inline evidence.
**Why cards not a table:** a table forces horizontal eye-travel across Action / Expected / Result / Actual for every row, and shrinks the two most important columns (action, expected) to fit. A vertical card gives the action full width and a clear top-to-bottom reading order that mirrors how the step is *performed*: read action → check expectation → record result → (optionally) annotate.
**Action dominant / expected as criteria:** the action is an instruction (do this); the expected result is an acceptance criterion (this must be true). Styling them differently — action as primary text, expected in a tinted criteria box — encodes that semantic difference and reduces "which one am I checking?" cognitive load.
**Left-edge accent** turns green/red/amber the instant a result is chosen, so scanning the page reveals failures and gaps immediately.

### 5.5 Status buttons (`.step-status-btn`)
**Pass / Fail / Blocked / Not Tested** as a single-click segmented control.
**Why:** this is the single most repeated action on the page. A dropdown costs open → read → select → close per step; a segmented control costs one click and shows current state without interaction. "Not Tested" is the default (nothing recorded yet) and is the explicit, auditable opposite of an accidental blank.

### 5.6 Inline evidence & expandable notes
**Why inline evidence per step:** evidence is meaningful *at the step it proves*. Forcing the tester to a separate panel breaks flow and loses the step→evidence link. Files are staged client-side and uploaded on submit with `description = "Step N — …"`, recovering step attribution inside the unchanged evidence schema.
**Why notes collapse:** most steps pass without comment. A collapsed `+ Note` keeps the list scannable and dense; expanding is one click for the minority that need observations. This is the "compact by default" principle made concrete.

### 5.7 Step Navigator (`.step-nav`)
**Shows:** a compact grid of numbered chips, each colored by current status, sticky in the side panel.
**Why:** long tests scroll off-screen. The navigator is both a map (where am I) and a worklist (which steps are unfinished/failed) and a jump control (click → smooth-scroll to the card). It answers "what's left?" without scrolling.

### 5.8 Collapsible side panel
**Holds:** Execution Details (summary, deviations), general evidence, execution history.
**Why collapsible / off to the side:** these are real but secondary — needed occasionally, not while recording each step. Demoting them from the main flow (where the old design mixed them with steps) gives steps the focus and keeps the page from feeling like a form.

### 5.9 Completion panel (`.completion-panel`)
**Appears when** every step has a recorded result.
**Shows:** execution statistics, the list of failed/blocked steps, deviation summary, evidence count, derived overall status, and the Review & Sign entry.
**Why gated on completion:** it both rewards finishing and creates a natural review checkpoint before the formal act of signing — surfacing failures and gaps while they can still be addressed.

### 5.10 Review & Sign (modal)
**Shows:** pass/fail/blocked statistics, outstanding issues, tester, SW/Env, an overall-result selector (pre-set to the derived value, overridable), and a prominent **✍ Sign & Submit**.
**Why a review screen:** the signature becomes part of the formal quality record (the server signs `EXECUTED`). A deliberate review — with the consequences and the full picture in front of the tester — fits a medical-device QMS far better than an inline submit. The primary action carries the magenta brand weight to communicate significance.

---

## 6. Visual language
- Layered surfaces: page `--bg-base`, cards `--bg-surface`, criteria/briefing insets `--bg-elevated`. No large flat white areas.
- Magenta `--brand` reserved for: Review & Sign / Sign & Submit, focus rings, progress fill, active step in navigator.
- Status accents (green/red/amber) only as **left borders** on step cards and **dots** on counters — never fills.
- Reuses existing tokens, `.badge`, `.card`, `.drop-zone`, `ICONS`, typography scale — so the page reads as native MagentiQA, comparable to Linear/Jira in density and polish.

## 7. Preserved functionality
Setup selection & per-setup attribution (`setupId`), step results, actual/notes, evidence upload, overall result, summary, deviations, auto-sign, execution history, deep-link navigation, and the responsive `#exec-layout` collapse are all retained. No API or schema change.
```
