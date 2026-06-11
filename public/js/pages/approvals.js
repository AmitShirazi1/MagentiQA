// public/js/pages/approvals.js — Review queue

async function renderApprovals(params = {}) {
  const el = document.getElementById('page-approvals');
  el.innerHTML = skeletonPage();
  try {
    const approvals = await API.approvals();
    const pending = approvals.filter(a => a.status === 'PENDING').length;
    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Approvals</h1>
          <p class="subtitle">${pending ? `${pending} request${pending === 1 ? '' : 's'} awaiting review` : 'No pending requests'}</p>
        </div>
        ${pending ? `<span class="badge badge-pending">${pending} pending</span>` : ''}
      </div>
      <div class="page-body">
        ${approvals.length === 0
          ? emptyState('No approvals yet', 'Approval requests appear here when verifications are submitted for review.', {
              icon: ICONS.check ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>` : undefined,
            })
          : `
        <div class="card flush">
          <div class="table-wrap">
            <table>
              <thead><tr>
                ${sortableTH('Item')}
                ${sortableTH('Approver')}
                ${sortableTH('Status')}
                ${sortableTH('Created')}
                <th>Comment</th>
                <th style="width:180px">Actions</th>
              </tr></thead>
              <tbody>
                ${approvals.map(a => `
                  <tr>
                    <td><span class="bold">${esc(a.label || a.testTitle || '—')}</span>${a.scope === 'VERSION' ? ' <span class="tag">version</span>' : ''}</td>
                    <td>${esc(a.approverName || '—')}</td>
                    <td data-sort="${esc(a.status)}">${badge(a.status)}</td>
                    <td class="t-meta" data-sort="${a.createdAt || ''}">${relTime(a.createdAt)}</td>
                    <td class="text-sm text-secondary">${esc(trunc(a.comment || '—', 40))}</td>
                    <td>
                      ${a.status === 'PENDING' && ['ADMIN', 'APPROVER'].includes(currentUser?.role) ? `
                      <div class="btn-row">
                        <button class="btn-primary btn-sm" onclick="resolveApproval('${a.id}','APPROVED')">${ICONS.check} Approve</button>
                        <button class="btn-danger btn-sm" onclick="resolveApproval('${a.id}','REJECTED')">Reject</button>
                      </div>` : '<span class="text-muted">—</span>'}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

async function resolveApproval(id, status) {
  if (status === 'REJECTED') {
    // Collect an optional reason in a proper dialog instead of window.prompt
    openModal('Reject approval', `
      <div class="field-group">
        <label for="rej-comment">Reason for rejection <span class="label-hint">optional</span></label>
        <textarea id="rej-comment" rows="3" placeholder="Why is this being rejected?"></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-danger" onclick="submitApprovalResolution('${id}','REJECTED')">Reject</button>
      </div>`);
    return;
  }
  await submitApprovalResolution(id, status);
}

async function submitApprovalResolution(id, status) {
  const comment = document.getElementById('rej-comment')?.value || '';
  closeModal();
  try {
    await API.updateApproval(id, { status, comment });
    toast(`Approval ${status.toLowerCase()}`, status === 'APPROVED' ? 'success' : 'info');
    renderApprovals();
    pollApprovalBadge();
  } catch (err) { toast(err.message, 'error'); }
}
