#!/usr/bin/env node
// Freight Audit for Claude Code: the one CLI. Human tables by default, --json for machines.
//   npm run freight -- --help
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import {
  TABLES, reads, insights, audit, decide, dispute, credit, closeDispute, approve, add, transaction,
  importInvoices, importConsignments, importRates, invoiceDetail, disputeDetail, resolve, required, refreshEstimates,
} from './lib/audit.mjs';

const money = (v, row) => {
  if (v === null || v === undefined) return '';
  const n = Number(v) / 100;
  return `${row.currency ? row.currency + ' ' : ''}${n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const cell = (v, k, row) => {
  if (k.endsWith('_cents')) return money(v, row);
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
function grid(rows) {
  if (!rows.length) return '  (none)';
  const keys = Object.keys(rows[0]).filter((k) => k !== 'currency' || !Object.keys(rows[0]).some((x) => x.endsWith('_cents')));
  const labels = keys.map((k) => k.replace(/_cents$/, ''));
  const body = rows.map((r) => keys.map((k) => cell(r[k], k, r)));
  const widths = keys.map((_, i) => Math.min(70, Math.max(labels[i].length, ...body.map((b) => b[i].length))));
  const fit = (s, i) => (s.length > widths[i] ? s.slice(0, widths[i] - 3) + '...' : s.padEnd(widths[i]));
  const line = (arr) => '  ' + arr.map(fit).join('  ').trimEnd();
  return [line(labels), '  ' + widths.map((w) => '-'.repeat(w)).join('  '), ...body.map(line)].join('\n');
}
export function format(result) {
  if (Array.isArray(result)) {
    if (result[0]?.question) return result.map((x, i) => `${i + 1}. ${x.question}\n${grid(x.rows)}`).join('\n\n');
    return grid(result);
  }
  if (result && typeof result === 'object') {
    const entries = Object.entries(result);
    const scalars = entries.filter(([, v]) => !v || typeof v !== 'object').map(([k, v]) => `${k}: ${v ?? ''}`);
    const blocks = entries.filter(([, v]) => v && typeof v === 'object').map(([k, v]) => `${k}\n${format(Array.isArray(v) ? v : [v])}`);
    return [scalars.join('\n'), ...blocks].filter(Boolean).join('\n\n');
  }
  return String(result);
}

export function parseArgs(args) {
  const opts = {};
  const pos = [];
  for (const a of args) {
    if (a.startsWith('--')) {
      const i = a.indexOf('=');
      opts[a.slice(2, i < 0 ? undefined : i)] = i < 0 ? true : a.slice(i + 1);
    } else pos.push(a);
  }
  return { opts, pos };
}
const ALLOWED = ['json', 'actor', 'dry-run', 'carrier', 'map', 'card', 'service', 'from', 'to', 'cubic', 'again', 'late', 'ref', 'help'];

function writePrivate(dir, name, text) {
  const out = path.join(process.env.OUTPUT_DIR || REPO_ROOT, dir);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const file = path.join(out, name);
  fs.writeFileSync(file, text, { mode: 0o600 });
  return file;
}

export async function run(db, args) {
  const { opts, pos } = parseArgs(args);
  for (const k of Object.keys(opts)) if (!ALLOWED.includes(k)) throw new Error(`Unknown option --${k}`);
  const [cmd, a, b, c, ...rest] = pos;
  const actor = opts.actor;

  if (cmd in reads) return db.query(reads[cmd]);
  if (cmd === 'insights') return insights(db);
  if (cmd === 'invoice') return invoiceDetail(db, a);
  if (cmd === 'dispute-detail') return disputeDetail(db, a);
  if (cmd === 'weekly-review') {
    return {
      attention: await db.query(reads.attention),
      exceptions: await db.query(reads.exceptions),
      disputes: await db.query("select * from dispute_aging where status in ('open', 'part_credited') order by raised_on"),
      scorecard: await db.query(reads.scorecard),
    };
  }
  if (cmd === 'month-end') {
    return {
      accrual: await db.query(reads.accruals),
      unbilled_over_45_days: await db.query('select connote, carrier, ship_date, estimate_cents, currency from unbilled where days_since_shipped > 45 order by ship_date'),
      allocation: await db.query("select * from cost_allocation where month >= to_char(current_date - 62, 'YYYY-MM') order by month desc, cost_centre"),
    };
  }
  if (cmd === 'audit') return transaction(db, actor, () => audit(db, a, { again: Boolean(opts.again) }));
  if (cmd === 'estimate') return transaction(db, actor, async () => ({ consignments_priced: await refreshEstimates(db, { all: true }) }));
  if (cmd === 'decide') return transaction(db, actor, () => decide(db, a, b, [c, ...rest].filter(Boolean).join(' '), actor));
  if (cmd === 'dispute') return transaction(db, actor, () => dispute(db, a, actor, { late: Boolean(opts.late), carrierRef: opts.ref || '' }));
  if (cmd === 'credit') return transaction(db, actor, () => credit(db, a, b, c, rest[0], actor));
  if (cmd === 'close-dispute') return transaction(db, actor, () => closeDispute(db, a, b, [c, ...rest].filter(Boolean).join(' '), actor));
  if (cmd === 'approve') return transaction(db, actor, () => approve(db, a, [b, c, ...rest].filter(Boolean).join(' '), actor));
  if (cmd === 'log') {
    return transaction(db, actor, async () => {
      const body = required([b, c, ...rest].filter(Boolean).join(' '), 'note');
      if (/^d-\d+$/i.test(a)) { const d = await resolve(db, 'disputes', a); return db.query('insert into notes (dispute_id, actor, body) values ($1,$2,$3) returning body', [d.id, actor, body]); }
      const inv = await resolve(db, 'invoices', a);
      return db.query('insert into notes (invoice_id, actor, body) values ($1,$2,$3) returning body', [inv.id, actor, body]);
    });
  }
  if (cmd === 'add') {
    const data = JSON.parse(fs.readFileSync(required(b, 'JSON file'), 'utf8'));
    return transaction(db, actor, () => add(db, a, data));
  }
  if (cmd === 'import') {
    const common = { carrier: opts.carrier, map: opts.map, dryRun: Boolean(opts['dry-run']), actor };
    if (a === 'invoices') return importInvoices(db, b, common);
    if (a === 'nshift') {
      if (!opts.map) throw new Error('import nshift needs --map=FILE naming your Invoice Explorer columns (see docs/replace-nshift-audit.md)');
      return importInvoices(db, b, { ...common, kind: 'nshift' });
    }
    if (a === 'consignments') return importConsignments(db, b, common);
    if (a === 'rates') return importRates(db, b, { ...common, card: opts.card, service: opts.service, from: opts.from, to: opts.to, cubic: opts.cubic || 250 });
    throw new Error('Use: import invoices|nshift|consignments|rates <csv>');
  }
  if (cmd === 'history') return db.query('select created_at, kind, source_file, rows_read, rows_loaded, actor from import_batches order by created_at desc');
  if (cmd === 'export') {
    const data = { format: 'freight-audit-v1', exported_at: new Date().toISOString(), tables: {} };
    await db.exec('BEGIN READ ONLY');
    try { for (const t of TABLES) data.tables[t] = await db.query(`select * from ${t} order by ${t === 'settings' ? 'key' : 'created_at, id'}`); } finally { await db.exec('ROLLBACK'); }
    const file = writePrivate('exports', `freight-audit-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.json`, JSON.stringify(data, null, 2) + '\n');
    return { file, counts: Object.fromEntries(TABLES.map((t) => [t, data.tables[t].length])) };
  }
  if (cmd === 'draft-dispute') {
    const d = await disputeDetail(db, a);
    const s = d.summary;
    const lines = d.lines.map((l) => `| ${l.connote} | ${l.rule} | ${l.detail} | ${money(l.billed_cents, s)} | ${money(l.expected_cents, s)} | ${money(l.variance_cents, s)} |`).join('\n');
    const text = `# DRAFT: not sent\n\nTo: ${s.carrier_name}${s.contact_email ? ` <${s.contact_email}>` : ''}\nSubject: Invoice ${s.invoice_no}: credit request ${s.code} (account ${s.account_no || 'see invoice'})\n\nHello,\n\nWe have checked invoice ${s.invoice_no} against our agreed rate card and our consignment records. The lines below do not match what was agreed. Please issue a credit note for ${money(s.claimed_cents, s)}, quoting ${s.code}.\n\n| Connote | Reason | Detail | Billed | Agreed | Difference |\n|---|---|---|---|---|---|\n${lines}\n\nWe are paying the rest of the invoice on the usual terms.\n\nRegards,\n[Your name]\n`;
    return { file: writePrivate('drafts', `dispute-${s.code}.md`, text), claimed: money(s.claimed_cents, s) };
  }
  if (cmd === 'draft-weekly-review') {
    const data = await run(db, ['weekly-review']);
    return { file: writePrivate('drafts', `weekly-review-${new Date().toISOString().slice(0, 10)}.md`, `# Freight audit: weekly review (draft for the operator)\n\n\`\`\`\n${format(data)}\n\`\`\`\n`) };
  }
  throw new Error(`Unknown command "${cmd || ''}". Run --help`);
}

export const help = `Freight Audit for Claude Code
Read:   ${Object.keys(reads).join(', ')}
        insights, weekly-review, month-end, invoice <no>, dispute-detail <code>, history
Audit:  audit [invoice] [--again] --actor=NAME      check new invoices against rate cards and consignments
        estimate --actor=NAME                        re-price every consignment from the rate cards
Decide: decide <finding> accepted|waived <reason> --actor=NAME
        dispute <invoice> [--ref=CARRIER_REF] [--late] --actor=NAME
        credit <dispute> <credit-no> <amount> <YYYY-MM-DD> --actor=NAME
        close-dispute <dispute> rejected|withdrawn <reason> --actor=NAME
        approve <invoice> <evidence> --actor=NAME   a local record; nothing is paid from here
        log <invoice|dispute> <note> --actor=NAME
Add:    add carrier|zone|surcharge|fuel-levy|setting <json-file> --actor=NAME
Import: import invoices <csv> --carrier=CODE [--map=FILE] [--dry-run] --actor=NAME
        import nshift <csv> --carrier=CODE --map=FILE [--dry-run] --actor=NAME
        import consignments <csv> --carrier=CODE [--map=FILE] [--dry-run] --actor=NAME
        import rates <csv> --carrier=CODE --card=CODE --service=NAME --from=YYYY-MM-DD --to=YYYY-MM-DD [--cubic=250] --actor=NAME
Out:    export, draft-dispute <code>, draft-weekly-review
Names match partly and case-insensitively; an ambiguous name lists the candidates and exits 1.
All commands take --json. No command sends email, pays a carrier or deletes a record.`;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) console.log(help);
  else {
    let db;
    try {
      db = await getDb();
      const result = await run(db, args);
      console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : format(result));
    } catch (e) {
      console.error(args.includes('--json') ? JSON.stringify({ error: e.message, candidates: e.candidates || [] }) : e.message + (e.candidates?.length ? '\n' + format(e.candidates) : ''));
      process.exitCode = 1;
    } finally {
      await db?.close();
    }
  }
}
