/**
 * lib/pdf.js — Generate PDF verification reports
 *
 * Page 1:  Cover + summary stats + test results overview table + signature slots
 * Page 2+: One full-detail page per test, ordered by tags then testId
 */

const path = require('path');
const fs   = require('fs');
const db   = require('./db');
const { setupRollup } = require('./rollup');

const PDF_DIR = path.join(__dirname, '..', 'storage', 'pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

// Magentiq Eye brand. The cover logo is embedded as a base64 data URI so the
// report is fully self-contained (works in both the Puppeteer render and the
// HTML fallback, with no external request). Read once at load; if the asset is
// missing the cover falls back to a styled "Magentiq Eye" wordmark.
const BRAND_MAGENTA = '#C026D3';
const LOGO_PATH = path.join(__dirname, '..', 'public', 'img', 'magentiq-eye-logo.png');
let LOGO_DATA_URI = '';
try { LOGO_DATA_URI = 'data:image/png;base64,' + fs.readFileSync(LOGO_PATH).toString('base64'); } catch { /* wordmark fallback */ }

// ─────────────────────────────────────────────────────────────────────────────

async function generateVersionReport(versionId) {
  const html      = buildReportHtml(versionId);

  // Name the file after the project + version it reports on, with spaces (and any
  // filename-unsafe characters) collapsed to single hyphens — e.g.
  // "Magentiq-Eye-Verification-Report-Main-Product-v1.0.0.pdf".
  const version   = db.versions.findById(versionId);
  const project   = version ? db.projects.findById(version.projectId) : null;
  const slug = s => String(s || '').trim().replace(/[\\/:*?"<>|\s-]+/g, '-').replace(/^-+|-+$/g, '');
  const namePart  = [slug(project?.name), slug(version?.name)].filter(Boolean).join('-');
  const filename  = `Magentiq-Eye-Verification-Report${namePart ? '-' + namePart : ''}.pdf`;
  const outPath   = path.join(PDF_DIR, filename);

  // Try puppeteer-core with any installed Chromium / Chrome
  const chromePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  let executablePath = chromePaths.find(p => { try { return fs.existsSync(p); } catch { return false; } });

  if (executablePath) {
    try {
      const puppeteer = require('puppeteer-core');
      const browser   = await puppeteer.launch({
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: outPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
      });
      await browser.close();
      return { path: outPath, type: 'pdf', filename };
    } catch (err) {
      // fall through to HTML fallback
    }
  }

  // HTML fallback (fully self-contained, looks identical when printed)
  const htmlPath = outPath.replace('.pdf', '.html');
  fs.writeFileSync(htmlPath, html);
  return { path: htmlPath, type: 'html', filename: filename.replace('.pdf', '.html') };
}

// ─────────────────────────────────────────────────────────────────────────────

function buildReportHtml(versionId) {
  const version = db.versions.findById(versionId);
  if (!version) throw new Error('Version not found');

  const project = db.projects.findById(version.projectId);
  const vTests  = db.versionTests.findAll({ versionId })
    .filter(vt => db.tests.findById(vt.testDefId));   // skip links to deleted definitions

  // ── Enrich each versionTest with test, executions, signatures ─────────────
  const enriched = vTests.map(vt => {
    const test       = db.tests.findById(vt.testDefId);
    const tags       = JSON.parse(test?.tags || '[]');
    const steps      = db.steps.query({ filter: { testId: vt.testDefId }, sortBy: 'order', sortDir: 'asc' });
    const executions = db.executions.findAll({ versionTestId: vt.id });
    // Setup-tracked verifications report a status rolled up across their setups,
    // and carry their setups table (each setup's verdict/tester comes from its
    // own execution in this version) so it can be rendered on the detail page.
    let setups = [];
    if (test && (test.type || 'STANDARD') === 'SETUP_TRACKED') {
      setups = db.setups.query({ filter: { testId: vt.testDefId }, sortBy: 'order', sortDir: 'asc' })
        .map(s => ({ ...s, data: safeParse(s.data, {}) }));
      vt = { ...vt, status: setupRollup(setups, executions).status };
    }
    const lastExec   = executions.sort((a, b) => (b.executedAt > a.executedAt ? 1 : -1))[0] || null;
    const sigs       = lastExec ? db.signatures.findAll({ executionId: lastExec.id }) : [];
    const stepResults = lastExec ? db.stepResults.findAll({ executionId: lastExec.id }) : [];
    const executor   = lastExec ? db.users.findById(lastExec.executorId) : null;
    return { vt, test, tags, steps, executions, setups, lastExec, stepResults, sigs, executor };
  });

  // ── Sort: primary = first tag alphabetically, secondary = testId ──────────
  enriched.sort((a, b) => {
    const ta = (a.tags[0] || '').toLowerCase();
    const tb = (b.tags[0] || '').toLowerCase();
    if (ta !== tb) return ta.localeCompare(tb);
    return (a.test?.testId || '').localeCompare(b.test?.testId || '');
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  // Use the rolled-up statuses computed during enrichment, not the raw records.
  const rolled = enriched.map(e => e.vt);
  const stats = {
    total:      rolled.length,
    passed:     rolled.filter(t => t.status === 'PASSED').length,
    partial:    rolled.filter(t => t.status === 'PARTIAL').length,
    failed:     rolled.filter(t => t.status === 'FAILED').length,
    inProgress: rolled.filter(t => t.status === 'IN_PROGRESS').length,
    notStarted: rolled.filter(t => t.status === 'NOT_STARTED').length,
  };
  const passRate = stats.total ? Math.round((stats.passed / stats.total) * 100) : 0;

  // Ordered Total → Not Started → In Progress → Failed → Partially Passed →
  // Passed. Not Started and In Progress are shown only when non-zero (a clean
  // report hides empty buckets); the rest always show.
  const statCards = [{ num: stats.total, label: 'Total', cls: '' }];
  if (stats.notStarted > 0) statCards.push({ num: stats.notStarted, label: 'Not Started', cls: 'not_started' });
  if (stats.inProgress > 0) statCards.push({ num: stats.inProgress, label: 'In Progress', cls: 'in_progress' });
  statCards.push(
    { num: stats.failed,  label: 'Failed',           cls: 'fail' },
    { num: stats.partial, label: 'Partially Passed', cls: 'partial' },
    { num: stats.passed,  label: 'Passed',           cls: 'pass' },
  );
  const statsHtml = statCards.map(s =>
    `<div class="stat ${s.cls}"><div class="num">${s.num}</div><div class="lbl">${s.label}</div></div>`).join('');

  // ── Overview table rows ───────────────────────────────────────────────────
  const overviewRows = enriched.map(({ vt, test, executor, lastExec }) => `
    <tr class="test-row ${vt.status.toLowerCase()}">
      <td>${esc(test?.testId || '—')}</td>
      <td>${esc(test?.title  || '—')}</td>
      <td class="tags-cell">${renderTagsText(JSON.parse(test?.tags || '[]'))}</td>
      <td>${statusPill(vt.status)}</td>
      <td>${lastExec ? fmtDate(lastExec.executedAt) : '—'}</td>
      <td>${esc(executor?.name || '—')}</td>
    </tr>`).join('');

  // ── Document approval signature (version-level "Approved By") ─────────────
  // Filled when an approver signs the version off; the per-verification
  // "Verified By" signatures live in each test's detail page below.
  const approvedSig = db.signatures.findAll({ versionId, meaning: 'APPROVED' })
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))[0] || null;
  const approvedUser = approvedSig ? db.users.findById(approvedSig.userId) : null;

  // ── Per-test detail pages ─────────────────────────────────────────────────
  const detailPages = enriched.map(({ vt, test, tags, steps, executions, setups, lastExec, stepResults, sigs, executor }) => {
    const isTracked = (test?.type || 'STANDARD') === 'SETUP_TRACKED';
    const srMap = {};
    for (const sr of stepResults) srMap[sr.stepId] = sr;

    // For setup-tracked verifications a step's Pass/Fail is rolled up across every
    // setup's latest execution (so it reflects all setups, not just the most recent
    // run); standard verifications use the single latest execution's step results.
    let aggByStep = null;
    if (isTracked) {
      const perStep = {};
      for (const ex of latestExecBySetup(executions).values()) {
        for (const sr of db.stepResults.findAll({ executionId: ex.id })) {
          (perStep[sr.stepId] = perStep[sr.stepId] || []).push(sr.result);
        }
      }
      aggByStep = {};
      for (const s of steps) aggByStep[s.id] = aggregateStepStatus(perStep[s.id]);
    }

    const stepsHtml = steps.map((s, i) => {
      const sr     = srMap[s.id] || {};
      const status = isTracked ? aggByStep[s.id] : (sr.result || null);
      return `
        <tr>
          <td class="step-num">${s.order || i + 1}</td>
          <td>${esc(s.action)}</td>
          <td class="text-secondary">${esc(s.expectedResult || '—')}</td>
          <td>${statusPill(status)}</td>
          <td class="text-secondary">${isTracked ? '—' : esc(sr.actual || '—')}</td>
        </tr>`;
    }).join('');

    const meta = [
      ['Configuration', test?.configuration || '—'],
      ['Files',         test?.files          || '—'],
      ['Description',   test?.description    || '—'],
      ['Pre conditions',test?.preconditions  || '—'],
      ...(test?.notes ? [['Notes', test.notes]] : []),
    ];

    // Setup-tracked verifications: render their setups table. Each setup's Status
    // and Tester are its outcome in THIS version — the verdict and signer of its
    // latest execution (falling back to the stored baseline when not yet run) —
    // so the Status/Tester columns are re-created rather than read from the data.
    const setupsHtml = renderSetupsSection(test, setups || [], executions || []);

    return `
      <div class="detail-page page-break">
        <div class="detail-header">
          <div>
            <span class="mono small">${esc(test?.testId || '')}</span>
            <h3>${esc(test?.title || '—')}</h3>
            <div class="tags-line">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>
          </div>
          <div class="result-badge">${statusPill(vt.status)}</div>
        </div>

        <div class="meta-grid">
          ${meta.map(([k, v]) => `
            <div class="meta-item">
              <div class="meta-label">${k}</div>
              <div class="meta-value">${esc(v)}</div>
            </div>`).join('')}
        </div>

        <h4 class="section-title">Steps</h4>
        <table class="steps-table">
          <thead>
            <tr>
              <th style="width:40px">#</th>
              <th>Action</th>
              <th>Expected Result</th>
              <th style="width:80px">Pass/Fail</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>${stepsHtml || '<tr><td colspan="5" class="no-steps">No steps defined</td></tr>'}</tbody>
        </table>

        ${setupsHtml}

        ${lastExec ? `
          <div class="exec-footer">
            <span>Executed: ${fmtDate(lastExec.executedAt)}</span>
            ${lastExec.swVersion ? `<span>SW: ${esc(lastExec.swVersion)}</span>` : ''}
            ${lastExec.environment ? `<span>Env: ${esc(lastExec.environment)}</span>` : ''}
            ${lastExec.deviations ? `<span>Deviations: ${esc(lastExec.deviations)}</span>` : ''}
          </div>` : ''}

        ${(() => {
          const vsig = (sigs || []).find(s => s.meaning === 'EXECUTED');
          return `
          <div class="sig-row" style="margin-top:14px">
            <div class="sig-box">
              <div class="role">Verified By</div>
              ${vsig
                ? `<div class="name">${esc(executor?.name || '—')}</div>
                   <div class="date">Date: ${fmtDate(vsig.timestamp)}</div>
                   <div class="hash">${vsig.hash || ''}</div>`
                : `<div class="name">___________________________</div>
                   <div class="date">Date: ___________________</div>
                   <div class="hash" style="color:#c0c0c0;font-size:9px">Filled when this verification is executed &amp; signed (Review &amp; Sign)</div>`}
            </div>
          </div>`;
        })()}
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Verification Report — ${esc(project?.name || '')} ${esc(version.name)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; }

/* ── Cover page ── */
.cover { padding: 56px 50px 28px; text-align: center; border-bottom: 3px solid #1e3a5f; }
.cover-logo-img { display: block; width: 210px; height: auto; margin: 0 auto; }
.cover-logo { font-size: 30px; font-weight: 800; color: #C026D3; letter-spacing: 3px; }   /* fallback wordmark */
.cover-title { font-size: 20px; font-weight: 700; color: #1e3a5f; letter-spacing: 4px;
               text-transform: uppercase; margin-top: 22px; }
.cover-sub { font-size: 12px; color: #64748b; margin-top: 6px; letter-spacing: 0.5px; }
.cover-meta { margin: 24px auto 0; display: flex; justify-content: center; flex-wrap: wrap; gap: 14px 44px; }
.cover-meta > div { text-align: center; }
.cover-meta .label { color: #94a3b8; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 1.2px; }
.cover-meta .value { color: #1a1a2e; margin-top: 3px; font-size: 13px; font-weight: 600; }

/* ── Sections ── */
section { padding: 24px 50px; }
h2 { font-size: 15px; font-weight: 700; color: #1e3a5f; border-bottom: 1px solid #e2e8f0;
     padding-bottom: 7px; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 1px; }

/* ── Stats grid ── */
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
.stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 10px; text-align: center; }
.stat .num { font-size: 22px; font-weight: 800; }
.stat .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-top: 2px; }
.stat.pass .num { color: #16a34a; }
.stat.partial .num { color: #d97706; }
.stat.fail .num { color: #dc2626; }
.stat.in_progress .num { color: #1660D6; }   /* blue, matching the app's in-progress */
.stat.not_started .num { color: #475569; }

/* ── Overview table ── */
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { background: #1e3a5f; color: #fff; font-weight: 600; text-transform: uppercase;
     font-size: 11px; letter-spacing: 0.5px; padding: 7px 9px; text-align: left; }
td { padding: 6px 9px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
tr:nth-child(even) td { background: #f8fafc; }
.tags-cell { font-size: 11px; color: #64748b; }

/* ── Badges ── */
.badge { display: inline-block; padding: 3px 7px; border-radius: 3px;
         font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.badge.passed, .badge.pass   { background: #dcfce7; color: #166534; }
.badge.partial               { background: #fef9c3; color: #854d0e; }
.badge.failed, .badge.fail   { background: #fee2e2; color: #991b1b; }
.badge.not_started            { background: #f1f5f9; color: #475569; }
.badge.not_tested             { background: #f1f5f9; color: #475569; }
.badge.in_progress            { background: #dbeafe; color: #1660D6; }
.badge.blocked                { background: #fbe0dd; color: #8D1D15; }   /* dark red, matching the app */

/* ── Signatures ── */
.sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 16px; }
.sig-box { border: 1px solid #cbd5e1; border-radius: 4px; padding: 14px 18px; }
.sig-box .role { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 600; }
.sig-box .name { font-size: 14px; font-weight: 700; margin-top: 4px; }
.sig-box .date { font-size: 12px; color: #64748b; margin-top: 2px; }
.sig-box .hash { font-size: 9px; color: #94a3b8; font-family: monospace; margin-top: 5px; word-break: break-all; }

/* ── Footer ── */
.page-footer { border-top: 1px solid #e2e8f0; padding: 12px 50px;
               font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }

/* ── Detail pages ── */
.page-break { page-break-before: always; }
.detail-page { padding: 30px 50px; }
.detail-header { display: flex; justify-content: space-between; align-items: flex-start;
                 border-bottom: 2px solid #1e3a5f; padding-bottom: 12px; margin-bottom: 16px; }
.detail-header h3 { font-size: 17px; font-weight: 700; color: #1e3a5f; margin-top: 3px; }
.mono { font-family: 'Courier New', monospace; }
.small { font-size: 11px; color: #64748b; }
.tags-line { margin-top: 5px; }
.tag { display: inline-block; background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;
       border-radius: 3px; padding: 1px 6px; font-size: 11px; margin-right: 4px; }

.meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
.meta-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 12px; }
.meta-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; font-weight: 600; margin-bottom: 3px; }
.meta-value { font-size: 12px; color: #1a1a2e; white-space: pre-wrap; }

.section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
                 color: #1e3a5f; margin-bottom: 8px; margin-top: 4px; }
.setups-note { font-size: 12px; color: #64748b; margin-bottom: 8px; }
.steps-table { font-size: 12px; }
.steps-table th { background: #334155; }
.step-num { width: 36px; text-align: center; font-family: monospace; color: #64748b; }
.text-secondary { color: #64748b; }
.no-steps { text-align: center; color: #94a3b8; padding: 12px; }

.exec-footer { margin-top: 10px; font-size: 11px; color: #64748b; display: flex; gap: 20px; }
.result-badge { flex-shrink: 0; }

@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page-break { page-break-before: always; }
}
</style>
</head>
<body>

<!-- ═══════════════════════════════ PAGE 1 ══════════════════════════════════ -->

<div class="cover">
  ${LOGO_DATA_URI
    ? `<img class="cover-logo-img" src="${LOGO_DATA_URI}" alt="Magentiq Eye">`
    : `<div class="cover-logo">Magentiq Eye</div>`}
  <div class="cover-title">Verification Report</div>
  <div class="cover-sub">${esc(project?.name || '—')} &middot; ${esc(version.name)}</div>
  <div class="cover-meta">
    <div><div class="label">Project</div><div class="value">${esc(project?.name || '—')}</div></div>
    <div><div class="label">Version</div><div class="value">${esc(version.name)}</div></div>
    <div><div class="label">Status</div><div class="value">${esc(version.status)}</div></div>
    <div><div class="label">Generated</div><div class="value">${fmtDate(new Date().toISOString())}</div></div>
    <div>
      <div class="label">Pass Rate</div>
      <div class="value" style="font-size:16px;font-weight:800;color:${passRate >= 80 ? '#16a34a' : '#dc2626'}">${passRate}%</div>
    </div>
  </div>
</div>

<section>
  <h2>Summary Statistics</h2>
  <div class="stats-grid" style="grid-template-columns:repeat(${statCards.length},1fr)">
    ${statsHtml}
  </div>
</section>

<section>
  <h2>Test Results Overview</h2>
  <table>
    <thead>
      <tr>
        <th>Test ID</th><th>Title</th><th>Tags</th>
        <th>Result</th><th>Executed</th><th>Verified By</th>
      </tr>
    </thead>
    <tbody>${overviewRows}</tbody>
  </table>
</section>

<section>
  <h2>Version Approval</h2>
  <p class="text-secondary" style="margin-bottom:10px">This sign-off certifies that the version was verified by all the verifications in this report. Each verification's own "Verified By" signature appears on its detail page.</p>
  <div class="sig-row">
    <div class="sig-box">
      <div class="role">Approved By</div>
      ${approvedUser
        ? `<div class="name">${esc(approvedUser.name)}</div>
           <div class="date">Date: ${fmtDate(approvedSig.timestamp)}</div>
           <div class="hash">${approvedSig.hash || ''}</div>`
        : `<div class="name">___________________________</div>
           <div class="date">Date: ___________________</div>
           <div class="hash" style="color:#c0c0c0;font-size:9px">Filled when the version is approved via the Approvals page</div>`}
    </div>
  </div>
</section>

<div class="page-footer">
  <span>Magentiq Eye · CONFIDENTIAL — For Internal Use Only</span>
  <span>Generated: ${new Date().toISOString()}</span>
</div>

<!-- ═════════════════════════ PAGES 2+ — TEST DETAILS ══════════════════════ -->

${detailPages}

</body>
</html>`;
}

function safeParse(json, fallback) { try { return JSON.parse(json); } catch { return fallback; } }

/** Latest (by executedAt) execution per setupId, ignoring setup-less runs. */
function latestExecBySetup(executions) {
  const byId = new Map();
  for (const e of executions || []) {
    if (!e.setupId) continue;
    const cur = byId.get(e.setupId);
    if (!cur || (e.executedAt || '') > (cur.executedAt || '')) byId.set(e.setupId, e);
  }
  return byId;
}

// One source of truth for status → { label, css class } so every place that
// shows a status pill (overview table, detail header, setups table, step
// results) renders identically. PASS/FAIL are the per-step spellings.
const STATUS_META = {
  PASSED:      { label: 'Passed',           cls: 'passed' },
  PASS:        { label: 'Pass',             cls: 'passed' },
  FAILED:      { label: 'Failed',           cls: 'failed' },
  FAIL:        { label: 'Fail',             cls: 'failed' },
  PARTIAL:     { label: 'Partially Passed', cls: 'partial' },
  BLOCKED:     { label: 'Blocked',          cls: 'blocked' },
  NOT_TESTED:  { label: 'Not Tested',       cls: 'not_tested' },
  IN_PROGRESS: { label: 'In Progress',      cls: 'in_progress' },
  NOT_STARTED: { label: 'Not Started',      cls: 'not_started' },
  PENDING:     { label: 'Pending',          cls: 'partial' },
};

/** A status badge for the given internal status, or an em-dash when empty. */
function statusPill(status) {
  if (!status) return '<span class="text-muted">—</span>';
  const m = STATUS_META[status] || { label: String(status).replace(/_/g, ' '), cls: '' };
  return `<span class="badge ${m.cls}">${esc(m.label)}</span>`;
}

/**
 * Aggregate one step's result across all setups of a setup-tracked verification:
 *   - recorded in no setup            → null (shown as —)
 *   - the same result in every setup  → that result (Pass / Fail / Blocked / Not Tested)
 *   - a mix (e.g. passed in some, failed in others) → PARTIAL ("Partially Passed")
 */
function aggregateStepStatus(results) {
  const set = new Set((results || []).filter(Boolean));
  if (set.size === 0) return null;
  if (set.size === 1) return [...set][0];
  return 'PARTIAL';
}

/**
 * Setups table for a setup-tracked verification's detail page. The Status and
 * Tester columns are re-created from each setup's outcome in this version (its
 * latest execution's verdict + signer), falling back to the stored baseline; the
 * remaining columns are the setup's descriptive data, kept in their stored order.
 * An "Executed" column carries each setup's run date.
 */
function renderSetupsSection(test, setups, executions) {
  if (!test || (test.type || 'STANDARD') !== 'SETUP_TRACKED' || !setups.length) return '';
  const cols = safeParse(test.setupColumns, []);
  const meta = safeParse(test.setupMeta, {});
  const latest = latestExecBySetup(executions);

  const rows = setups.map(s => {
    const ex     = latest.get(s.setupId);
    // The setup's verdict: its latest execution result, the imported baseline, or
    // Not Started when it hasn't been performed. Blocked / Not Tested render too.
    const status = ex ? ex.result : (s.status || 'NOT_STARTED');
    const tester = ex ? (db.users.findById(ex.executorId)?.name || '—') : (s.testerName || '');
    const cells = cols.map(c => {
      if (meta.statusColumn && c === meta.statusColumn) return `<td>${statusPill(status)}</td>`;
      if (meta.testerColumn && c === meta.testerColumn) return `<td>${esc(tester || '—')}</td>`;
      return `<td class="text-secondary">${esc((s.data && s.data[c]) || '—')}</td>`;
    }).join('');
    return `<tr>${cells}<td class="text-secondary">${ex ? fmtDate(ex.executedAt) : '—'}</td></tr>`;
  }).join('');

  return `
    <h4 class="section-title">Setups</h4>
    <p class="setups-note">This verification is performed under all of the setups specified below.</p>
    <table class="steps-table">
      <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}<th style="width:120px">Executed</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderTagsText(tags) {
  return (tags || []).join(', ');
}

module.exports = { generateVersionReport, buildReportHtml, aggregateStepStatus, statusPill };
