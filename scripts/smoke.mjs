#!/usr/bin/env node
// npm test: a temporary database, the demo data, every command, the imports, the audit rules,
// the dashboards and the documents. Set TEST_DATABASE_URL to also run it against a disposable
// Postgres (its public schema is dropped first; never point it at real data).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run } from './freight.mjs';
import { reads } from './lib/audit.mjs';

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function suite(label, env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freight-audit-test-'));
  Object.assign(process.env, { OUTPUT_DIR: tmp, DATA_DIR: path.join(tmp, 'db'), DATABASE_URL: env.DATABASE_URL || '' });
  let db = await getDb();
  try {
    if (db.mode === 'postgres') await db.exec('drop schema public cascade; create schema public;');
    assert.equal((await migrate(db)).ran.length, 1);
    assert.equal((await migrate(db)).ran.length, 0, 'migrate is repeatable');
    await seed(db);
    await seed(db);
    assert.equal((await db.query("select count(*)::int as n from carriers"))[0].n, 3, 'seed is idempotent');

    // Every read command answers.
    for (const cmd of Object.keys(reads)) assert(Array.isArray(await run(db, [cmd])), cmd);
    for (const cmd of ['insights', 'weekly-review', 'month-end', 'history']) assert(await run(db, [cmd]), cmd);

    // The audit found what the demo data hides.
    const rules = (await run(db, ['exceptions'])).map((f) => `${f.invoice_no}:${f.rule}`);
    for (const want of ['RL-INV-5101:WEIGHT', 'RL-INV-5101:FUEL', 'RL-INV-5101:SURCHARGE_NOT_REQUESTED', 'OC-88213:DUPLICATE', 'OC-88213:ZONE', 'OC-88213:NO_CONSIGNMENT', 'OC-88213:TAX_INVOICE', 'PP-3340:GST']) {
      assert(rules.includes(want), `missing finding ${want}`);
    }
    const weight = (await run(db, ['exceptions'])).find((f) => f.rule === 'WEIGHT');
    assert.equal(Number(weight.variance_cents), 3360, 'weight finding prices the line at our chargeable weight');
    const att = (await run(db, ['attention'])).map((a) => a.item);
    for (const want of ['dispute window closing', 'dispute window closed', 'dispute with no answer', 'shipped, never billed', 'rate card expiring']) assert(att.includes(want), `attention lacks ${want}`);
    assert((await run(db, ['compliance'])).some((c) => c.rule === 'PAYMENT_TIMES_SMALL_BUSINESS'));
    assert.equal((await run(db, ['accruals'])).reduce((a, r) => a + r.consignments, 0), 3);

    // Decisions, disputes, credits and approval.
    await assert.rejects(run(db, ['approve', 'RL-INV-5101', 'checked', '--actor=Test']), /still open/);
    await assert.rejects(run(db, ['dispute', 'PP-3340', '--actor=Test']), /window closed/);
    await assert.rejects(run(db, ['dispute', 'RL-INV-5101']), /--actor/);
    const d = await run(db, ['dispute', 'RL-INV-5101', '--actor=Test']);
    assert.equal(d.claimed, '84.81');
    const credited = await run(db, ['credit', d.dispute, 'CN-T1', '84.81', day(0), '--actor=Test']);
    assert.equal(credited.status, 'credited');
    const approved = await run(db, ['approve', 'RL-INV-5101', 'Checked by Test against PODs', '--actor=Test']);
    assert.equal(approved.held_in_dispute, '84.81');
    const tax = (await run(db, ['exceptions'])).find((f) => f.rule === 'TAX_INVOICE');
    await run(db, ['decide', tax.finding, 'waived', 'Valid tax invoice received', '--actor=Test']);
    await assert.rejects(run(db, ['decide', tax.finding, 'waived', 'again', '--actor=Test']), /already/);
    await run(db, ['log', 'OC-88213', 'Asked OC for a corrected invoice', '--actor=Test']);
    await assert.rejects(run(db, ['invoice', 'RL']), (e) => e.candidates.length === 2);

    // Imports: a rate card, consignments, then a carrier invoice, audited.
    const rates = path.join(tmp, 'rates.csv');
    fs.copyFileSync(path.join(REPO_ROOT, 'examples', 'rates.csv'), rates);
    await run(db, ['import', 'rates', rates, '--carrier=RL', '--card=RL-2027', '--service=Road general freight', `--from=${day(21)}`, `--to=${day(386)}`, '--actor=Test']);
    const swap = (f) => fs.readFileSync(path.join(REPO_ROOT, 'examples', f), 'utf8').replaceAll('2026-11-02', day(-8)).replaceAll('2026-11-03', day(-7)).replaceAll('2026-11-12', day(-2)).replaceAll('2026-12-02', day(18));
    fs.writeFileSync(path.join(tmp, 'k.csv'), swap('consignments.csv'));
    fs.writeFileSync(path.join(tmp, 'i.csv'), swap('carrier-invoice.csv'));
    const dry = await run(db, ['import', 'invoices', path.join(tmp, 'i.csv'), '--carrier=RL', '--dry-run']);
    assert.equal(dry.would_load[0].lines, 5);
    assert.equal((await run(db, ['import', 'consignments', path.join(tmp, 'k.csv'), '--carrier=RL', '--actor=Test'])).loaded, 2);
    assert.deepEqual((await run(db, ['import', 'invoices', path.join(tmp, 'i.csv'), '--carrier=RL', '--actor=Test'])).loaded, ['RL-INV-6001']);
    assert.deepEqual((await run(db, ['import', 'invoices', path.join(tmp, 'i.csv'), '--carrier=RL', '--actor=Test'])).skipped_already_loaded, ['RL-INV-6001'], 'an invoice never loads twice');
    const audited = await run(db, ['audit', '--actor=Test']);
    assert.deepEqual(audited.map((a) => [a.invoice_no, a.findings]), [['RL-INV-6001', 1]], 'only the admin fee is wrong');
    assert.equal((await run(db, ['invoice', 'RL-INV-6001'])).findings[0].rule, 'SURCHARGE_NOT_AGREED');
    await assert.rejects(run(db, ['import', 'nshift', path.join(tmp, 'i.csv'), '--carrier=RL', '--actor=Test']), /--map/);

    const exp = await run(db, ['export']);
    assert(JSON.parse(fs.readFileSync(exp.file, 'utf8')).tables.invoices.length >= 7);
    assert(fs.existsSync((await run(db, ['draft-dispute', d.dispute])).file));
    assert(fs.existsSync((await run(db, ['draft-weekly-review'])).file));
    await db.close();
    db = null;

    // The CLI as a person runs it, the dashboards and the documents.
    const cli = (args) => spawnSync(process.execPath, [path.join('scripts', 'freight.mjs'), ...args], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
    const ok = cli(['exceptions', '--json']);
    assert.equal(ok.status, 0, ok.stderr);
    assert(Array.isArray(JSON.parse(ok.stdout)));
    const ambiguous = cli(['invoice', 'oc-88', '--json']);
    assert.equal(ambiguous.status, 1);
    assert.equal(JSON.parse(ambiguous.stderr).candidates.length, 2);
    assert(cli(['--help']).stdout.includes('import nshift'));
    for (const script of ['view', 'docs']) {
      const r = spawnSync(process.execPath, [path.join('scripts', `${script}.mjs`)], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    }
    assert.equal(fs.readdirSync(path.join(tmp, 'views')).length, 3);
    const claims = fs.readdirSync(path.join(tmp, 'docs-out', 'carrier-claim'));
    assert(claims.length >= 1);
    assert(fs.readFileSync(path.join(tmp, 'docs-out', 'carrier-claim', claims[0]), 'utf8').includes('Harbour Homewares Demo'));
    assert(fs.readdirSync(path.join(tmp, 'docs-out', 'invoice-audit')).length >= 6);
    console.log(`PASS ${label}: migrate, seed, ${Object.keys(reads).length + 4} reads, audit rules, dispute to credit, imports, export, drafts, 3 dashboards, 2 documents`);
  } finally {
    await db?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

await suite('embedded database', {});
if (process.env.TEST_DATABASE_URL) await suite('Postgres', { DATABASE_URL: process.env.TEST_DATABASE_URL });
