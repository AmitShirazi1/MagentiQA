/**
 * lib/audit.js — Immutable audit trail
 * Stores verification-relevant events plus user-lifecycle changes (account
 * creation/invite, role changes, (de)activation, password changes/resets).
 * Routine logins/logouts are intentionally NOT recorded. Password values are
 * never written — callers pass only a marker in the before/after payload.
 */

const db = require('./db');

// Actions and entities that belong in the audit trail
const AUDITED_ENTITIES = new Set([
  'users',
  'tests', 'steps', 'versionTests', 'versions', 'projects',
  'executions', 'approvals', 'signatures', 'evidence',
]);

const AUDITED_ACTIONS = new Set([
  'CREATE', 'UPDATE', 'DELETE', 'RESET', 'EXECUTE', 'APPROVE', 'SIGN', 'IMPORT', 'EXPORT', 'LINK', 'UNLINK',
]);

function audit(userId, action, entity, entityId, before, after, req) {
  // Filter: only store verification-relevant events
  if (!AUDITED_ENTITIES.has(entity)) return;
  if (!AUDITED_ACTIONS.has(action)) return;

  const now = new Date().toISOString();
  db.auditLogs.create({
    userId: userId || 'system',
    action,
    entity,
    entityId,
    before: before ? JSON.stringify(before) : null,
    after:  after  ? JSON.stringify(after)  : null,
    timestamp: now,   // explicit — db.create also sets createdAt, but we store our own
    ipAddress: req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress) : null,
    userAgent: req ? req.headers['user-agent'] : null,
  });
}

module.exports = { audit };
