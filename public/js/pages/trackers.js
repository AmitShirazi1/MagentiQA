// public/js/pages/trackers.js — "Setup Trackers" library
// Lists setup-tracked verifications (the ones that own a setups table) with
// their baseline coverage. Editing reuses the verification edit modal.

async function renderTrackers(params = {}) {
  const el = document.getElementById('page-trackers');
  el.innerHTML = skeletonPage();

  try {
    const tests = await API.tests.list({ type: 'SETUP_TRACKED' });

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Setup Trackers</h1>
          <p class="subtitle">${tests.length} setup-tracked verification${tests.length === 1 ? '' : 's'}</p>
        </div>
        <button class="btn-primary" onclick="openNewTestModal({ type: 'SETUP_TRACKED' })">${ICONS.plus} New Setup-Tracked Verification</button>
      </div>
      <div class="page-body">
        <div id="trackers-table">${renderTrackersTable(tests)}</div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

function renderTrackersTable(tests) {
  if (!tests.length) return emptyState('No setup trackers yet',
    'Import a verification with its “… test tracker.xlsx”, or create a setup-tracked verification.', {
      action: { label: 'New Setup-Tracked Verification', onclick: "openNewTestModal({ type: 'SETUP_TRACKED' })" },
    });

  return `
    <div class="card flush">
      <div class="table-wrap">
        <table>
          <thead><tr>
            ${sortableTH('Test ID')}
            ${sortableTH('Title')}
            <th style="width:84px">Actions</th>
            <th>Tags</th>
            ${sortableTH('Setups')}
            <th style="width:200px">Coverage</th>
          </tr></thead>
          <tbody>
            ${tests.map(t => {
              const cov = t.setupCoverage || { passed: 0, total: (t.setups || []).length };
              return `
              <tr>
                <td class="mono">${esc(t.testId)}</td>
                <td><div class="clickable-title" onclick="openEditTestModal('${t.id}')">${esc(t.title)}</div></td>
                <td>
                  <div style="display:flex;gap:2px;flex-wrap:nowrap">
                    <button class="icon-btn" title="Edit" aria-label="Edit" onclick="openEditTestModal('${t.id}')">${ICONS.edit}</button>
                    <button class="icon-btn" title="Delete" aria-label="Delete" style="color:var(--fail)" onclick="deleteTrackerTest('${t.id}')">${ICONS.x}</button>
                  </div>
                </td>
                <td>${(t.tags || []).slice(0, 4).map(tag => `<span class="tag">${esc(tag)}</span>`).join(' ')}</td>
                <td class="tabular">${(t.setups || []).length}</td>
                <td>${progressBar(cov.passed || 0, cov.total || 0)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function deleteTrackerTest(id) {
  const ok = await confirmDialog('Delete verification?',
    'This permanently deletes the verification definition and its setups. This cannot be undone.',
    { confirmLabel: 'Delete' });
  if (!ok) return;
  try {
    await API.tests.delete(id);
    toast('Verification deleted', 'info');
    renderTrackers();
  } catch (err) { toast(err.message, 'error'); }
}
