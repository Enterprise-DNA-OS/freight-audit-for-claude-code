#!/usr/bin/env node
// Loads the demo data (supabase/seed.sql), then audits the demo invoices that have not been
// checked yet. seed.sql returns early when the demo carriers exist, so a second run does nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { audit } from './lib/audit.mjs';

export async function seed(db) {
  await db.exec('BEGIN');
  try {
    await db.exec(readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8'));
    await audit(db); // check the demo invoices that arrived since the last audit
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    if (db.mode === 'postgres' && !process.argv.includes('--demo-database')) {
      throw new Error('Shared database seed requires --demo-database. Use only an empty disposable demo database.');
    }
    await seed(db);
    console.log(`seed: demo data ready (${db.mode})`);
  } finally {
    await db.close();
  }
}
