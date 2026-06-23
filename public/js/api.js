// public/js/api.js — Thin API client for all backend calls
const API = {
  async req(method, path, body, isForm = false) {
    const opts = { method, credentials: 'include' };
    if (body) {
      if (isForm) {
        opts.body = body;
      } else {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch('/api' + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  get:    (path)         => API.req('GET',    path),
  post:   (path, body)   => API.req('POST',   path, body),
  put:    (path, body)   => API.req('PUT',    path, body),
  delete: (path)         => API.req('DELETE', path),
  upload: (path, form)   => API.req('POST',   path, form, true),

  // Like upload(), but reports upload byte progress via onProgress(pct 0–100).
  // Uses XMLHttpRequest because fetch() can't observe upload progress.
  uploadProgress: (path, form, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api' + path);
    xhr.withCredentials = true;
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(form);
  }),

  // Auth
  auth: {
    me:       ()           => API.get('/auth/me'),
    login:    (username, pw) => API.post('/auth/login', { username, password: pw }),
    logout:   ()           => API.post('/auth/logout'),
    getInvite:    (token)      => API.get(`/auth/invite/${token}`),
    acceptInvite: (token, pw)  => API.post(`/auth/invite/${token}/accept`, { password: pw }),
    changePassword: (current, next) => API.post('/auth/password', { currentPassword: current, newPassword: next }),
  },

  // Projects
  projects: {
    list:          ()          => API.get('/projects'),
    get:           (id)        => API.get(`/projects/${id}`),
    create:        (data)      => API.post('/projects', data),
    update:        (id, data)  => API.put(`/projects/${id}`, data),
    delete:        (id)        => API.delete(`/projects/${id}`),
    versions:      (pid)       => API.get(`/projects/${pid}/versions`),
    createVersion: (pid, data) => API.post(`/projects/${pid}/versions`, data),
    getVersion:    (pid, vid)  => API.get(`/projects/${pid}/versions/${vid}`),
    updateVersion: (pid, vid, data) => API.put(`/projects/${pid}/versions/${vid}`, data),
    deleteVersion: (pid, vid)  => API.delete(`/projects/${pid}/versions/${vid}`),
  },

  // Tests
  tests: {
    list:        (params = {}) => API.get('/tests' + toQuery(params)),
    get:         (id)          => API.get(`/tests/${id}`),
    create:      (data)        => API.post('/tests', data),
    update:      (id, data)    => API.put(`/tests/${id}`, data),
    delete:      (id)          => API.delete(`/tests/${id}`),
    convert:     (id, to, extra = {}) => API.post(`/tests/${id}/convert`, { to, ...extra }),
    // version-linked tests
    forVersion:  (vid)         => API.get(`/tests/version/${vid}`),
    addToVersion:(vid, data)   => API.post(`/tests/version/${vid}`, data),
    updateVT:    (vid, vtid, data) => API.put(`/tests/version/${vid}/${vtid}`, data),
    removeFromVersion: (vid, vtid) => API.delete(`/tests/version/${vid}/${vtid}`),
    resetVT:     (vid, vtid)   => API.post(`/tests/version/${vid}/${vtid}/reset`),
  },

  // Executions
  executions: {
    list:       (vtId)    => API.get(`/executions?versionTestId=${vtId}`),
    get:        (id)      => API.get(`/executions/${id}`),
    create:     (data)    => API.post('/executions', data),
    drafts:     (vtId)    => API.get(`/executions/drafts?versionTestId=${vtId}`),
    saveDraft:  (data)    => API.put('/executions/draft', data),
    sign:       (id, meaning) => API.post(`/executions/${id}/sign`, { meaning }),
    bulkSign:   (ids, meaning) => API.post('/executions/bulk-sign', { executionIds: ids, meaning }),
    verify:     (id)      => API.get(`/executions/${id}/verify`),
    evidence:   (id)      => API.get(`/executions/${id}/evidence`),
    uploadEvidence: (id, formData) => API.upload(`/executions/${id}/evidence`, formData),
    deleteEvidence: (eid, evid)  => API.delete(`/executions/${eid}/evidence/${evid}`),
  },

  // Misc
  audit:     (params = {}) => API.get('/audit' + toQuery(params)),
  users:     ()             => API.get('/users'),
  updateUser:(id, data)     => API.put(`/users/${id}`, data),
  inviteUser:(data)         => API.post('/users/invite', data),
  listInvites: ()           => API.get('/users/invites'),
  revokeInvite: (id)        => API.delete(`/users/invites/${id}`),
  deactivateUser: (id)      => API.post(`/users/${id}/deactivate`),
  reactivateUser: (id)      => API.post(`/users/${id}/reactivate`),
  adminResetPassword: (id, pw) => API.post(`/users/${id}/reset-password`, { newPassword: pw }),
  approvals: (params = {})  => API.get('/approvals' + toQuery(params)),
  createApproval: (data)    => API.post('/approvals', data),
  requestVersionApproval: (versionId, comment) => API.post('/approvals', { scope: 'VERSION', versionId, comment }),
  updateApproval: (id, data) => API.put(`/approvals/${id}`, data),
  dashboard: (vid)          => API.get(`/dashboard/${vid}`),
  templates: ()             => API.get('/templates'),
  importPreview:   (form) => API.upload('/import/preview', form),
  importSave:      (data) => API.post('/import/save', data),
  importSaveBatch: (data) => API.post('/import/save-batch', data),
  exportReport:  (vid)      => `/api/export/report/${vid}`,   // (A) download PDF report (results + approvals)
  exportTests:   ()         => '/api/export/tests',
  exportVersion: (vid)      => `/api/export/version/${vid}`,

  // Backup (admin)
  createBackup:    (label)  => API.post('/backup', label ? { label } : {}),
  backups:         ()       => API.get('/backups'),
  downloadBackup:  (name)   => `/api/backups/${encodeURIComponent(name)}/download`,

  // Google Drive integration
  google: {
    status:       ()             => API.get('/google/status'),
    folders:      (parent)       => API.get('/google/folders' + toQuery(parent ? { parent } : {})),
    folderInfo:   (id)           => API.get('/google/folder-info' + toQuery({ id })),
    sync:         (folder)       => API.post('/google/sync', { folder }),
    disconnect:   ()             => API.post('/google/disconnect'),
    uploadReport: (vid, folder)  => API.post('/google/upload-report', { versionId: vid, folder }),     // (B) PDF report → Drive
    exportVersion:(vid, folder)  => API.post('/google/export-version', { versionId: vid, folder }),    // (C) blank templates → Drive
  },
};

function toQuery(params) {
  const q = new URLSearchParams(params).toString();
  return q ? '?' + q : '';
}
