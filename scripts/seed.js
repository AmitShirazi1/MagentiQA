'use strict';
const path = require('path');
const fs   = require('fs');

for (const d of ['data', 'storage/evidence', 'storage/pdfs', 'storage/imports']) {
  fs.mkdirSync(path.join(__dirname, '..', d), { recursive: true });
}

const db     = require('../lib/db');
const bcrypt = require('bcryptjs');

async function seed() {
  console.log('🌱  Seeding database…');

  // Admin user — username "sysadmin", no email domain required
  let user = db.users.findOne({ username: 'sysadmin' });
  if (user) {
    console.log('   ✓  User sysadmin already exists, skipping.');
  } else {
    const passwordHash = await bcrypt.hash('admin123', 10);
    user = db.users.create({
      name: 'System Admin',
      username: 'sysadmin',
      passwordHash,
      role: 'ADMIN',
    });
    console.log('   ✓  Created user: sysadmin / admin123');
  }

  let project = db.projects.findOne({ name: 'Main Product' });
  if (!project) {
    project = db.projects.create({
      name: 'Main Product',
      type: 'US_SOFTWARE',
      description: 'Primary software product under ISO 13485 / FDA 21 CFR Part 820.',
      status: 'ACTIVE',
      createdBy: user.id,
    });
    console.log('   ✓  Created project: Main Product');
  }

  let version = db.versions.findOne({ projectId: project.id, name: 'v1.0.0' });
  if (!version) {
    version = db.versions.create({
      projectId: project.id,
      name: 'v1.0.0',
      description: 'Initial verification release.',
      status: 'IN_PROGRESS',
      createdBy: user.id,
    });
    console.log('   ✓  Created version: v1.0.0');
  }

  console.log('\n🎉  Seed complete!');
  console.log('   Login: sysadmin / admin123\n');
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
