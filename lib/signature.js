/**
 * lib/signature.js — FDA 21 CFR Part 11 style electronic signatures
 * Uses HMAC-SHA256 (Node crypto) to sign: userId + entityId + timestamp + meaning
 */

const crypto = require('crypto');
const db = require('./db');
const { audit } = require('./audit');

const SECRET = process.env.SIGNATURE_SECRET || 'magentiqa-sig-secret-change-in-production';

function computeHash(userId, entityId, timestamp, meaning) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${userId}:${entityId}:${timestamp}:${meaning}`)
    .digest('hex');
}

/**
 * Create a signature record for an entity.
 *   meaning:    'EXECUTED' | 'REVIEWED' | 'APPROVED'
 *   entityType: 'EXECUTION' (per-verification run, the PDF "Verified By") |
 *               'VERSION'   (version-level sign-off, the PDF "Approved By")
 * `entityId` is the execution id or the version id accordingly. The execution-
 * scoped `executionId` column is still populated for EXECUTION signatures so the
 * many existing `findAll({ executionId })` lookups keep working unchanged.
 */
function sign(userId, entityId, meaning, req, entityType = 'EXECUTION') {
  const timestamp = new Date().toISOString();
  const hash = computeHash(userId, entityId, timestamp, meaning);

  const sig = db.signatures.create({
    userId,
    entityType,
    entityId,
    executionId: entityType === 'EXECUTION' ? entityId : null,
    versionId:   entityType === 'VERSION'   ? entityId : null,
    meaning,
    timestamp,
    hash,
    ipAddress: req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : null,
  });

  audit(userId, 'SIGN', 'signatures', sig.id, null, sig, req);
  return sig;
}

/**
 * Verify a signature record hasn't been tampered with. Falls back to the legacy
 * `executionId` for rows written before signatures carried `entityId`.
 */
function verify(sigId) {
  const sig = db.signatures.findById(sigId);
  if (!sig) return { valid: false, reason: 'Signature not found' };
  const entityId = sig.entityId || sig.executionId;
  const expected = computeHash(sig.userId, entityId, sig.timestamp, sig.meaning);
  if (sig.hash !== expected) return { valid: false, reason: 'Hash mismatch — tampered' };
  return { valid: true };
}

module.exports = { sign, verify };
