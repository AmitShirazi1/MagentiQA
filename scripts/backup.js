'use strict';
/**
 * scripts/backup.js — Snapshot the whole application into a single zip.
 *
 * Usage: npm run backup
 *
 * Delegates to lib/backup.js (the same code path the admin "Backup" button
 * uses) so the CLI and the UI always produce identical archives:
 *   backups/magentiqa-backup-<timestamp>.zip
 * containing a consistent DB snapshot, the storage/ files, all application
 * code, and a BACKUP-MANIFEST.json.
 *
 * Use this instead of hand-copying folders in the shell — a mistyped
 * `cp -r "{data,storage}"` once created a literal `{data,storage` folder.
 */

const { createBackup } = require('../lib/backup');

createBackup('cli')
  .then(({ filename, sizeBytes, fileCount }) => {
    const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
    console.log(`\n🎉  Backup complete: backups/${filename}`);
    console.log(`    ${fileCount} files, ${mb} MB\n`);
  })
  .catch(err => {
    console.error('Backup failed:', err);
    process.exit(1);
  });
