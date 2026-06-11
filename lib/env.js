/**
 * lib/env.js — Minimal .env loader (no dependency needed)
 *
 * The app previously shipped a .env.example but never actually loaded .env,
 * so SESSION_SECRET / SIGNATURE_SECRET / CI API key were silently ignored.
 * Require this module before anything that reads process.env.
 */

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m || m[1].startsWith('#')) continue;
    const key = m[1];
    let value = m[2];
    // strip optional surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
