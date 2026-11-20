// The freight audit: what each carrier agreed, what was sent, what was billed.
// Every function takes the db handle from lib/db.mjs. Nothing here sends, pays or deletes.
import fs from 'node:fs';
import { parseCsv, pick } from './csv.mjs';

export const TABLES = ['settings', 'carriers', 'zones', 'rate_cards', 'rate_lines', 'surcharges', 'fuel_levies', 'import_batches', 'consignments', 'invoices', 'invoice_lines', 'disputes', 'findings', 'credit_notes', 'notes'];

export function required(v, what) {
  if (v === undefined || v === null || String(v).trim() === '') throw new Error(`Missing ${what}`);
  return String(v).trim();
}
export function isoDate(v, what = 'date') {
  const s = required(v, what);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) throw new Error(`${what} must be YYYY-MM-DD, got "${s}"`);
  return s;
}
// "1,234.50", "$1234.5", "-12" -> integer cents
export function cents(v, what = 'amount') {
  const s = required(v, what).replace(/[$,\s]/g, '').replace(/^(NZD|AUD)/i, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`${what} is not a money amount: "${v}"`);
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const value = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return neg ? -value : value;
}
const dollars = (c) => (Number(c) / 100).toFixed(2);

// Find one row by code, number or name. Ambiguous: throw with the candidates (the CLI exits 1).
const FINDERS = {
  carriers: { sql: 'select id, code, name from carriers', keys: ['code', 'name'] },
  invoices: { sql: 'select i.id, i.invoice_no, c.code as carrier, i.invoice_date, i.status from invoices i join carriers c on c.id = i.carrier_id', keys: ['invoice_no'] },
  disputes: { sql: 'select d.id, d.code, c.code as carrier, d.status from disputes d join carriers c on c.id = d.carrier_id', keys: ['code'] },
  findings: { sql: "select f.id, i.invoice_no, f.rule, f.decision from findings f join invoices i on i.id = f.invoice_id", keys: ['id'] },
  rate_cards: { sql: 'select r.id, r.code, c.code as carrier from rate_cards r join carriers c on c.id = r.carrier_id', keys: ['code'] },
};
export async function resolve(db, kind, ref) {
  const q = required(ref, `${kind.replace(/s$/, '').replace('_', ' ')} reference`).toLowerCase();
  const rows = await db.query(FINDERS[kind].sql);
  const val = (r, k) => String(r[k]).toLowerCase();
  const exact = rows.filter((r) => FINDERS[kind].keys.some((k) => val(r, k) === q));
  const hits = exact.length ? exact : rows.filter((r) => FINDERS[kind].keys.some((k) => val(r, k).includes(q)) || String(r.id).startsWith(q));
  if (hits.length === 1) return hits[0];
  const e = new Error(hits.length ? `"${ref}" matches ${hits.length} ${kind}; be more specific` : `No ${kind.replace('_', ' ')} matches "${ref}"`);
  e.candidates = hits.map(({ id, ...rest }) => ({ id: String(id).slice(0, 8), ...rest }));
  throw e;
}

export async function transaction(db, actor, fn) {
  required(actor, '--actor=NAME (who is making this change)');
  await db.exec('BEGIN');
  try {
    const out = await fn();
    await db.exec('COMMIT');
    return out;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

async function setting(db, key, fallback) {
  const [r] = await db.query('select value from settings where key = $1', [key]);
  return r ? Number(r.value) : fallback;
}

// ---------------------------------------------------------------- the rate card

async function zoneOf(db, carrierId, postcode) {
  const [z] = await db.query('select zone from zones where carrier_id = $1 and $2 between postcode_from and postcode_to order by postcode_to - postcode_from limit 1', [carrierId, postcode]);
  return z?.zone || null;
}
async function cardFor(db, carrierId, onDate) {
  const [c] = await db.query('select * from rate_cards where carrier_id = $1 and $2::date between valid_from and valid_to order by valid_from desc limit 1', [carrierId, onDate]);
  return c || null;
}
export function chargeableKg(deadKg, cubicM3, cubicFactor) {
  return Math.ceil(Math.max(Number(deadKg), Number(cubicM3) * Number(cubicFactor)) - 1e-9);
}
async function levyFor(db, carrierId, shipDate) {
  const [l] = await db.query("select levy_bps from fuel_levies where carrier_id = $1 and month = date_trunc('month', $2::date)::date", [carrierId, shipDate]);
  return l ? Number(l.levy_bps) : null;
}

// What the agreed rates say one consignment should cost. Returns the parts and any reason it cannot be priced.
export async function price(db, k) {
  const card = await cardFor(db, k.carrier_id, k.ship_date);
  if (!card) return { problem: `No rate card valid on ${k.ship_date}` };
  const oz = await zoneOf(db, k.carrier_id, k.origin_postcode);
  const dz = await zoneOf(db, k.carrier_id, k.dest_postcode);
  if (!oz || !dz) return { card, problem: `No zone for postcode ${!oz ? k.origin_postcode : k.dest_postcode}` };
  const [lane] = await db.query('select * from rate_lines where rate_card_id = $1 and origin_zone = $2 and dest_zone = $3', [card.id, oz, dz]);
  if (!lane) return { card, oz, dz, problem: `No ${oz} to ${dz} lane on ${card.code}` };
  const kg = chargeableKg(k.dead_kg, k.cubic_m3, card.cubic_factor);
  const freight = Math.max(Number(lane.min_cents), Number(lane.basic_cents) + Number(lane.per_kg_cents) * kg);
  const levy = await levyFor(db, k.carrier_id, k.ship_date);
  const fuel = levy === null ? null : Math.round((freight * levy) / 10000);
  const agreed = await db.query('select * from surcharges where rate_card_id = $1', [card.id]);
  const services = k.services || [];
  const extras = agreed.filter((s) => services.includes(s.code));
  const surcharge = extras.reduce((a, s) => a + Number(s.amount_cents), 0);
  return { card, oz, dz, kg, freight, levy, fuel, agreed, surcharge, total: freight + (fuel || 0) + surcharge };
}

export async function refreshEstimates(db, { all = false } = {}) {
  const rows = await db.query(`select * from consignments ${all ? '' : 'where estimate_cents is null'}`);
  for (const k of rows) {
    const p = await price(db, k);
    await db.query('update consignments set estimate_cents = $2, estimate_note = $3 where id = $1', [k.id, p.problem ? null : p.total, p.problem || `${p.oz} to ${p.dz}, ${p.kg} kg on ${p.card.code}${p.fuel === null ? ', no fuel levy for the month' : ''}`]);
  }
  return rows.length;
}

// ---------------------------------------------------------------- the audit

export async function auditInvoice(db, invoiceId) {
  const tolerance = await setting(db, 'tolerance_cents', 200);
  const weightTol = await setting(db, 'weight_tolerance_pct', 3);
  const [inv] = await db.query('select i.*, c.country, c.currency as carrier_currency from invoices i join carriers c on c.id = i.carrier_id where i.id = $1', [invoiceId]);
  await db.query("delete from findings where invoice_id = $1 and decision = 'open'", [inv.id]);
  const lines = await db.query('select * from invoice_lines where invoice_id = $1 order by line_no', [inv.id]);
  const found = [];
  const add = (line, rule, detail, billed, expected) => found.push({ line: line?.id || null, rule, detail, billed, expected, variance: billed - expected });
  const priced = new Map();

  for (const l of lines) {
    const amount = Number(l.amount_cents);
    let expected = amount;
    const [k] = l.connote ? await db.query('select * from consignments where carrier_id = $1 and connote = $2', [inv.carrier_id, l.connote]) : [];
    const [dup] = await db.query(
      `select i.invoice_no, x.line_no from invoice_lines x join invoices i on i.id = x.invoice_id
       where i.carrier_id = $1 and x.connote = $2 and x.kind = $3 and x.charge_code = $4 and x.id <> $5 and x.connote <> ''
         and (i.invoice_date < $6::date or (i.id = $7 and x.line_no < $8) or (i.invoice_date = $6::date and i.invoice_no < $9))
       order by i.invoice_date limit 1`,
      [inv.carrier_id, l.connote, l.kind, l.charge_code, l.id, inv.invoice_date, inv.id, l.line_no, inv.invoice_no]);
    if (dup) {
      expected = 0;
      add(l, 'DUPLICATE', `Already billed on ${dup.invoice_no} line ${dup.line_no}`, amount, 0);
    } else if (l.kind === 'other') {
      expected = 0;
      add(l, 'OTHER_CHARGE', `Charge not covered by the rate card: ${l.description || l.charge_code}`, amount, 0);
    } else if (!k) {
      expected = 0;
      add(l, 'NO_CONSIGNMENT', `Connote ${l.connote || '(blank)'} is not one of our consignments`, amount, 0);
    } else {
      if (!priced.has(k.id)) priced.set(k.id, await price(db, k));
      const p = priced.get(k.id);
      if (p.problem) {
        expected = amount;
        add(l, 'NO_RATE', p.problem, amount, amount);
      } else if (p.card.currency !== inv.currency) {
        add(l, 'CURRENCY', `Billed in ${inv.currency}, rate card ${p.card.code} is ${p.card.currency}`, amount, amount);
      } else if (l.kind === 'freight') {
        expected = p.freight;
        const billedOz = l.origin_postcode ? await zoneOf(db, inv.carrier_id, l.origin_postcode) : p.oz;
        const billedDz = l.dest_postcode ? await zoneOf(db, inv.carrier_id, l.dest_postcode) : p.dz;
        const overKg = l.billed_kg !== null && Number(l.billed_kg) > p.kg * (1 + weightTol / 100);
        if (billedOz !== p.oz || billedDz !== p.dz) add(l, 'ZONE', `Billed ${billedOz || '?'} to ${billedDz || '?'}, consignment went ${p.oz} to ${p.dz}`, amount, expected);
        else if (overKg) add(l, 'WEIGHT', `Billed ${Number(l.billed_kg)} kg, consignment chargeable ${p.kg} kg (${Number(k.dead_kg)} kg dead, ${Number(k.cubic_m3)} m3)`, amount, expected);
        else if (Math.abs(amount - expected) > tolerance) add(l, 'RATE', `${p.oz} to ${p.dz} at ${p.kg} kg on ${p.card.code} is ${dollars(expected)}`, amount, expected);
      } else if (l.kind === 'fuel') {
        if (p.levy === null) {
          add(l, 'FUEL_LEVY_UNKNOWN', `No fuel levy recorded for ${String(k.ship_date).slice(0, 7)}`, amount, amount);
        } else {
          expected = p.fuel;
          if (Math.abs(amount - expected) > tolerance) add(l, 'FUEL', `Levy ${(p.levy / 100).toFixed(2)}% on agreed freight ${dollars(p.freight)} is ${dollars(expected)}`, amount, expected);
        }
      } else if (l.kind === 'surcharge') {
        const s = p.agreed.find((x) => x.code === l.charge_code);
        if (!s) { expected = 0; add(l, 'SURCHARGE_NOT_AGREED', `${l.charge_code || l.description} is not on rate card ${p.card.code}`, amount, 0); }
        else if (s.needs_service && !(k.services || []).includes(s.code)) { expected = 0; add(l, 'SURCHARGE_NOT_REQUESTED', `${s.code} billed but the consignment did not ask for it`, amount, 0); }
        else { expected = Number(s.amount_cents); if (Math.abs(amount - expected) > tolerance) add(l, 'SURCHARGE_RATE', `${s.code} agreed at ${dollars(expected)}`, amount, expected); }
      }
    }
    await db.query('update invoice_lines set expected_cents = $2 where id = $1', [l.id, expected]);
  }

  const sum = lines.reduce((a, l) => a + Number(l.amount_cents), 0);
  if (sum !== Number(inv.total_ex_cents)) add(null, 'TOTAL', `Lines add to ${dollars(sum)}, invoice says ${dollars(inv.total_ex_cents)}`, Number(inv.total_ex_cents), sum);
  const rate = inv.country === 'AU' ? 1000 : 1500;
  const gst = Math.round((Number(inv.total_ex_cents) * rate) / 10000);
  if (Math.abs(Number(inv.gst_cents) - gst) > 2) add(null, 'GST', `GST at ${rate / 100}% on ${dollars(inv.total_ex_cents)} is ${dollars(gst)}`, Number(inv.gst_cents), gst);
  if (!String(inv.supplier_tax_number || '').trim()) add(null, 'TAX_INVOICE', 'No GST number or ABN on the invoice: ask for a valid tax invoice before claiming GST', 0, 0);

  for (const f of found) {
    await db.query(
      `insert into findings (invoice_id, invoice_line_id, rule, detail, billed_cents, expected_cents, variance_cents)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (invoice_id, invoice_line_id, rule) do nothing`,
      [inv.id, f.line, f.rule, f.detail, f.billed, f.expected, f.variance]);
  }
  const [{ open }] = await db.query("select count(*)::int as open from findings where invoice_id = $1 and decision = 'open'", [inv.id]);
  const status = inv.status === 'received' || inv.status === 'on_hold' ? (open ? 'on_hold' : 'received') : inv.status;
  await db.query('update invoices set audited_at = now(), status = $2 where id = $1', [inv.id, status]);
  return { invoice_no: inv.invoice_no, lines: lines.length, findings: open, status };
}

export async function audit(db, ref, { again = false } = {}) {
  await refreshEstimates(db);
  const targets = ref
    ? [await resolve(db, 'invoices', ref)]
    : await db.query(`select id from invoices where status in ('received', 'on_hold') ${again ? '' : 'and audited_at is null'} order by invoice_date, invoice_no`);
  const out = [];
  for (const t of targets) out.push(await auditInvoice(db, t.id));
  return out;
}

// ---------------------------------------------------------------- decisions

export async function decide(db, ref, decision, note, actor) {
  if (!['accepted', 'waived'].includes(decision)) throw new Error('Decision must be accepted or waived (use dispute <invoice> to dispute)');
  required(note, 'a reason for the decision');
  const f = await resolve(db, 'findings', ref);
  if (f.decision !== 'open') throw new Error(`Finding is already ${f.decision}`);
  return db.query('update findings set decision = $2, decision_note = $3, decided_by = $4, decided_at = now() where id = $1 returning id, rule, decision', [f.id, decision, note, actor]);
}

export async function dispute(db, ref, actor, { late = false, carrierRef = '' } = {}) {
  const inv = await resolve(db, 'invoices', ref);
  const [win] = await db.query('select dispute_by, days_to_dispute from invoice_audit where id = $1', [inv.id]);
  if (win.days_to_dispute < 0 && !late) throw new Error(`The dispute window closed on ${win.dispute_by}. Add --late to raise it anyway and record why with log.`);
  const open = await db.query("select id, variance_cents from findings where invoice_id = $1 and decision = 'open' and variance_cents > 0", [inv.id]);
  if (!open.length) throw new Error('No open overcharges on this invoice to dispute');
  const claimed = open.reduce((a, f) => a + Number(f.variance_cents), 0);
  const [{ n }] = await db.query("select nextval('dispute_seq')::int as n");
  const [d] = await db.query(
    `insert into disputes (code, carrier_id, invoice_id, raised_by, claimed_cents, carrier_ref)
     select $1, carrier_id, id, $2, $3, $4 from invoices where id = $5 returning id, code, claimed_cents`,
    [`D-${n}`, actor, claimed, carrierRef, inv.id]);
  await db.query("update findings set decision = 'disputed', dispute_id = $2, decided_by = $3, decided_at = now() where id = any($1::uuid[])", [open.map((f) => f.id), d.id, actor]);
  await db.query("update invoices set status = 'disputed' where id = $1", [inv.id]);
  return { dispute: d.code, invoice: inv.invoice_no, findings: open.length, claimed: dollars(claimed) };
}

export async function credit(db, ref, creditNo, amount, onDate, actor) {
  const d = await resolve(db, 'disputes', ref);
  const value = cents(amount, 'credit amount');
  if (value <= 0) throw new Error('Credit amount must be positive');
  const [full] = await db.query('select * from disputes where id = $1', [d.id]);
  await db.query('insert into credit_notes (carrier_id, dispute_id, credit_no, credit_date, amount_cents) values ($1, $2, $3, $4, $5)', [full.carrier_id, d.id, required(creditNo, 'credit note number'), isoDate(onDate, 'credit date'), value]);
  const credited = Number(full.credited_cents) + value;
  const status = credited >= Number(full.claimed_cents) ? 'credited' : 'part_credited';
  await db.query("update disputes set credited_cents = $2, status = $3, closed_on = case when $3 = 'credited' then $4::date else closed_on end where id = $1", [d.id, credited, status, onDate]);
  await db.query('insert into notes (dispute_id, actor, body) values ($1, $2, $3)', [d.id, actor, `Credit note ${creditNo} for ${dollars(value)} recorded`]);
  return { dispute: d.code, credited: dollars(credited), claimed: dollars(full.claimed_cents), status };
}

export async function closeDispute(db, ref, status, note, actor) {
  if (!['rejected', 'withdrawn'].includes(status)) throw new Error('Close a dispute as rejected or withdrawn');
  const d = await resolve(db, 'disputes', ref);
  await db.query('update disputes set status = $2, closed_on = current_date where id = $1', [d.id, status]);
  await db.query('insert into notes (dispute_id, actor, body) values ($1, $2, $3)', [d.id, actor, `${status}: ${required(note, 'a reason')}`]);
  return { dispute: d.code, status };
}

export async function approve(db, ref, evidence, actor) {
  const inv = await resolve(db, 'invoices', ref);
  const [full] = await db.query('select * from invoices where id = $1', [inv.id]);
  if (!full.audited_at) throw new Error('Audit the invoice first');
  const [{ open }] = await db.query("select count(*)::int as open from findings where invoice_id = $1 and decision = 'open'", [inv.id]);
  if (open) throw new Error(`${open} finding(s) still open: accept, waive or dispute them first`);
  const [{ held }] = await db.query("select coalesce(sum(variance_cents), 0)::bigint as held from findings where invoice_id = $1 and decision = 'disputed'", [inv.id]);
  await db.query("update invoices set status = 'approved', approved_at = now(), approved_by = $2, approval_evidence = $3 where id = $1", [inv.id, actor, required(evidence, 'an evidence reference (who checked, where)')]);
  return { invoice: inv.invoice_no, approved_to_pay: dollars(Number(full.total_ex_cents) - Number(held)), held_in_dispute: dollars(held), note: 'A local record only. Nothing is paid from here.' };
}

// ---------------------------------------------------------------- reads

export const reads = {
  attention: 'select item, what, why, due from attention order by due, item',
  invoices: 'select invoice_no, carrier, invoice_date, due_date, status, currency, billed_cents, expected_cents, open_findings, open_variance_cents, dispute_by from invoice_audit order by invoice_date desc, invoice_no',
  exceptions: 'select substr(id::text, 1, 8) as finding, invoice_no, carrier, connote, rule, currency, billed_cents, expected_cents, variance_cents, days_left from open_findings order by days_left, variance_cents desc',
  disputes: 'select code, carrier, invoice_no, raised_on, status, currency, claimed_cents, credited_cents, outstanding_cents, days_open from dispute_aging order by status, raised_on',
  unbilled: 'select connote, carrier, ship_date, cost_centre, currency, estimate_cents, days_since_shipped from unbilled order by ship_date',
  accruals: 'select cost_centre, currency, count(*)::int as consignments, sum(estimate_cents)::bigint as accrual_cents, count(*) filter (where estimate_cents is null)::int as unpriced from unbilled group by cost_centre, currency order by cost_centre',
  scorecard: 'select carrier, invoices, lines, lines_with_findings, error_rate_pct, currency, overbilled_cents, credited_cents from carrier_scorecard order by overbilled_cents desc',
  surcharges: `select c.code as carrier, l.charge_code as code, count(*)::int as times_billed,
      i.currency, sum(l.amount_cents)::bigint as billed_cents,
      round(100.0 * count(*) / nullif((select count(distinct x.connote) from invoice_lines x join invoices y on y.id = x.invoice_id where y.carrier_id = c.id and x.kind = 'freight'), 0), 1) as pct_of_consignments,
      count(f.id)::int as challenged
    from invoice_lines l join invoices i on i.id = l.invoice_id join carriers c on c.id = i.carrier_id
    left join findings f on f.invoice_line_id = l.id
    where l.kind = 'surcharge' group by c.id, c.code, l.charge_code, i.currency order by billed_cents desc`,
  allocation: 'select month, cost_centre, carrier, currency, consignments, billed_cents from cost_allocation order by month desc, cost_centre, carrier',
  'rate-cards': 'select code, carrier, service, valid_from, valid_to, days_left, lanes from rate_card_expiry order by valid_to',
  carriers: 'select code, name, country, currency, payment_terms_days as terms_days, dispute_window_days, small_business, active from carriers order by code',
  'lane-cost': `with per as (
      select k.id, k.carrier_id, k.origin_postcode, k.dest_postcode, k.dead_kg, i.currency, sum(l.amount_cents) as billed
      from invoice_lines l join invoices i on i.id = l.invoice_id
      join consignments k on k.carrier_id = i.carrier_id and k.connote = l.connote
      group by k.id, i.currency)
    select c.code as carrier,
      (select zone from zones z where z.carrier_id = p.carrier_id and p.origin_postcode between z.postcode_from and z.postcode_to limit 1) as origin,
      (select zone from zones z where z.carrier_id = p.carrier_id and p.dest_postcode between z.postcode_from and z.postcode_to limit 1) as destination,
      count(*)::int as consignments, sum(p.dead_kg)::numeric(10,0) as kg, p.currency, sum(p.billed)::bigint as billed_cents,
      round(sum(p.billed) / nullif(sum(p.dead_kg), 0) / 100.0, 2) as per_kg
    from per p join carriers c on c.id = p.carrier_id
    group by 1, 2, 3, p.currency order by per_kg desc nulls last`,
  compliance: 'select rule, record, carrier, finding from compliance_findings order by rule, record',
};

export async function invoiceDetail(db, ref) {
  const inv = await resolve(db, 'invoices', ref);
  const [summary] = await db.query('select invoice_no, carrier, invoice_date, due_date, status, currency, billed_cents, expected_cents, variance_cents, open_findings, dispute_by from invoice_audit where id = $1', [inv.id]);
  const lines = await db.query('select l.line_no, l.connote, l.kind, l.charge_code, l.billed_kg, i.currency, l.amount_cents, l.expected_cents, (l.amount_cents - coalesce(l.expected_cents, l.amount_cents)) as variance_cents from invoice_lines l join invoices i on i.id = l.invoice_id where l.invoice_id = $1 order by l.line_no', [inv.id]);
  const findings = await db.query('select substr(f.id::text, 1, 8) as finding, l.line_no, f.rule, f.detail, i.currency, f.variance_cents, f.decision from findings f join invoices i on i.id = f.invoice_id left join invoice_lines l on l.id = f.invoice_line_id where f.invoice_id = $1 order by l.line_no nulls last, f.rule', [inv.id]);
  const notes = await db.query('select created_at, actor, body from notes where invoice_id = $1 order by created_at', [inv.id]);
  return { summary, lines, findings, notes };
}

export async function disputeDetail(db, ref) {
  const d = await resolve(db, 'disputes', ref);
  const [summary] = await db.query('select a.*, c.name as carrier_name, c.account_no, c.contact_email from dispute_aging a join disputes d on d.code = a.code join carriers c on c.id = d.carrier_id where d.id = $1', [d.id]);
  const lines = await db.query('select coalesce(l.connote, \'invoice\') as connote, f.rule, f.detail, i.currency, f.billed_cents, f.expected_cents, f.variance_cents from findings f join invoices i on i.id = f.invoice_id left join invoice_lines l on l.id = f.invoice_line_id where f.dispute_id = $1 order by l.line_no nulls last', [d.id]);
  const credits = await db.query('select n.credit_no, n.credit_date, c.currency, n.amount_cents from credit_notes n join carriers c on c.id = n.carrier_id where n.dispute_id = $1 order by n.credit_date', [d.id]);
  const notes = await db.query('select created_at, actor, body from notes where dispute_id = $1 order by created_at', [d.id]);
  return { summary, lines, credits, notes };
}

export const QUESTIONS = [
  ['Which carrier overbills us the most, and how much has it credited back?', 'select carrier, currency, overbilled_cents, credited_cents, error_rate_pct from carrier_scorecard order by overbilled_cents desc'],
  ['Which surcharges are billed on consignments that never asked for them?', "select l.charge_code, c.code as carrier, count(*)::int as times, i.currency, sum(f.variance_cents)::bigint as overbilled_cents from findings f join invoice_lines l on l.id = f.invoice_line_id join invoices i on i.id = f.invoice_id join carriers c on c.id = i.carrier_id where f.rule = 'SURCHARGE_NOT_REQUESTED' group by 1, 2, i.currency order by overbilled_cents desc"],
  ['How much money is sitting in findings nobody has decided?', 'select carrier, currency, count(*)::int as findings, sum(variance_cents)::bigint as open_cents, min(days_left) as fewest_days_left from open_findings group by carrier, currency order by open_cents desc'],
  ['Which open findings lose their dispute window this fortnight?', 'select invoice_no, carrier, rule, currency, variance_cents, dispute_by from open_findings where days_left between 0 and 14 order by dispute_by'],
  ['How much of what we claimed has actually come back?', "select carrier, currency, sum(claimed_cents)::bigint as claimed_cents, sum(credited_cents)::bigint as credited_cents, round(100.0 * sum(credited_cents) / nullif(sum(claimed_cents), 0), 1) as recovered_pct from dispute_aging group by carrier, currency"],
  ['Which consignments were billed heavier than we weighed them?', "select l.connote, c.code as carrier, l.billed_kg, k.dead_kg, k.cubic_m3, i.currency, f.variance_cents from findings f join invoice_lines l on l.id = f.invoice_line_id join invoices i on i.id = f.invoice_id join carriers c on c.id = i.carrier_id join consignments k on k.carrier_id = i.carrier_id and k.connote = l.connote where f.rule = 'WEIGHT'"],
  ['What freight have we shipped that no carrier has billed yet, by cost centre?', 'select cost_centre, currency, count(*)::int as consignments, sum(estimate_cents)::bigint as accrual_cents from unbilled group by cost_centre, currency order by accrual_cents desc nulls last'],
  ['Which lanes cost the most per kilo?', reads['lane-cost']],
  ['Which rate cards run out before the next review, and how many lanes do they price?', 'select code, carrier, valid_to, days_left, lanes from rate_card_expiry where days_left <= 60 order by valid_to'],
  ['Which invoices are due within a week and still not cleared to pay?', "select invoice_no, carrier, due_date, status, open_findings from invoice_audit where status in ('received', 'on_hold') and due_date <= current_date + 7 order by due_date"],
];
export async function insights(db) {
  const out = [];
  for (const [question, sql] of QUESTIONS) out.push({ question, rows: await db.query(sql) });
  return out;
}

// ---------------------------------------------------------------- import

function mapped(row, map, field, ...fallbacks) {
  const names = map?.[field] ? [].concat(map[field]) : [field, ...fallbacks];
  return pick(row, ...names);
}
function readRows(file, mapFile) {
  const rows = parseCsv(fs.readFileSync(required(file, 'CSV file'), 'utf8'));
  const map = mapFile ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : null;
  return { rows, map };
}
const intOrNull = (v) => (String(v ?? '').trim() === '' ? null : Number.parseInt(v, 10));
const numOrNull = (v) => (String(v ?? '').trim() === '' ? null : Number(String(v).replace(/[^0-9.\-]/g, '')));

async function batch(db, kind, file, read, loaded, actor) {
  const [b] = await db.query('insert into import_batches (kind, source_file, rows_read, rows_loaded, actor) values ($1, $2, $3, $4, $5) returning id', [kind, String(file).split(/[\\/]/).pop(), read, loaded, actor]);
  return b.id;
}

// A carrier's invoice file: one row per invoice line. Rows sharing an invoice number become one invoice.
export async function importInvoices(db, file, { carrier, map: mapFile, dryRun = false, actor, kind = 'invoices' }) {
  const c = await resolve(db, 'carriers', required(carrier, '--carrier=CODE'));
  const [car] = await db.query('select * from carriers where id = $1', [c.id]);
  const { rows, map } = readRows(file, mapFile);
  const groups = new Map();
  rows.forEach((r, i) => {
    const no = required(mapped(r, map, 'invoice_no', 'invoice number', 'invoice'), `invoice number on row ${i + 2}`);
    if (!groups.has(no)) groups.set(no, []);
    groups.get(no).push({ r, i });
  });
  const plan = [];
  for (const [no, list] of groups) {
    const first = list[0].r;
    const [exists] = await db.query('select id from invoices where carrier_id = $1 and invoice_no = $2', [c.id, no]);
    const date = isoDate(mapped(first, map, 'invoice_date', 'invoice date', 'date'), `invoice date for ${no}`);
    const due = mapped(first, map, 'due_date', 'due date') || null;
    const lines = list.map(({ r, i }, n) => {
      const k = (mapped(r, map, 'kind', 'charge type', 'type') || 'freight').toLowerCase();
      return {
        line_no: n + 1,
        connote: mapped(r, map, 'connote', 'consignment', 'consignment number', 'shipment number', 'tracking number'),
        kind: ['freight', 'fuel', 'surcharge'].includes(k) ? k : k.includes('fuel') ? 'fuel' : k.includes('surch') ? 'surcharge' : k.includes('freight') ? 'freight' : 'other',
        charge_code: mapped(r, map, 'charge_code', 'charge code', 'code').toUpperCase(),
        description: mapped(r, map, 'description', 'charge description'),
        billed_kg: numOrNull(mapped(r, map, 'billed_kg', 'weight', 'chargeable weight')),
        origin_postcode: intOrNull(mapped(r, map, 'origin_postcode', 'from postcode', 'sender postcode')),
        dest_postcode: intOrNull(mapped(r, map, 'dest_postcode', 'to postcode', 'receiver postcode')),
        amount_cents: cents(mapped(r, map, 'amount', 'amount ex gst', 'net amount'), `amount on row ${i + 2}`),
      };
    });
    const total = lines.reduce((a, l) => a + l.amount_cents, 0);
    const gstText = list.map(({ r }) => mapped(r, map, 'gst', 'invoice gst', 'tax')).find((v) => v);
    plan.push({
      invoice_no: no, exists: Boolean(exists), invoice_date: date,
      due_date: due ? isoDate(due, `due date for ${no}`) : null, lines,
      total_ex_cents: total,
      gst_cents: gstText ? cents(gstText, `GST for ${no}`) : Math.round((total * (car.country === 'AU' ? 1000 : 1500)) / 10000),
      tax_number: mapped(first, map, 'tax_number', 'gst number', 'abn'),
    });
  }
  const summary = { carrier: c.code, rows: rows.length, invoices: plan.length, skipped_already_loaded: plan.filter((p) => p.exists).map((p) => p.invoice_no), dry_run: dryRun };
  if (dryRun) return { ...summary, would_load: plan.filter((p) => !p.exists).map((p) => ({ invoice_no: p.invoice_no, lines: p.lines.length, total: dollars(p.total_ex_cents) })) };
  return transaction(db, actor, async () => {
    const todo = plan.filter((p) => !p.exists);
    const batchId = await batch(db, kind, file, rows.length, todo.reduce((a, p) => a + p.lines.length, 0), actor);
    for (const p of todo) {
      const [inv] = await db.query(
        `insert into invoices (carrier_id, invoice_no, invoice_date, due_date, currency, total_ex_cents, gst_cents, supplier_tax_number, import_batch_id)
         values ($1, $2, $3, coalesce($4::date, $3::date + $5::int), $6, $7, $8, $9, $10) returning id`,
        [c.id, p.invoice_no, p.invoice_date, p.due_date, car.payment_terms_days, car.currency, p.total_ex_cents, p.gst_cents, p.tax_number, batchId]);
      for (const l of p.lines) {
        await db.query('insert into invoice_lines (invoice_id, line_no, connote, kind, charge_code, description, billed_kg, origin_postcode, dest_postcode, amount_cents) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [inv.id, l.line_no, l.connote, l.kind, l.charge_code, l.description, l.billed_kg, l.origin_postcode, l.dest_postcode, l.amount_cents]);
      }
    }
    return { ...summary, loaded: todo.map((p) => p.invoice_no), batch: batchId, next: 'Run audit to check them' };
  });
}

export async function importConsignments(db, file, { carrier, map: mapFile, dryRun = false, actor }) {
  const c = await resolve(db, 'carriers', required(carrier, '--carrier=CODE'));
  const { rows, map } = readRows(file, mapFile);
  const parsed = rows.map((r, i) => ({
    connote: required(mapped(r, map, 'connote', 'consignment', 'consignment number', 'tracking number'), `connote on row ${i + 2}`),
    ship_date: isoDate(mapped(r, map, 'ship_date', 'ship date', 'despatch date'), `ship date on row ${i + 2}`),
    delivered_on: mapped(r, map, 'delivered_on', 'delivered', 'pod date') || null,
    origin_postcode: intOrNull(required(mapped(r, map, 'origin_postcode', 'from postcode', 'sender postcode'), `origin postcode on row ${i + 2}`)),
    dest_postcode: intOrNull(required(mapped(r, map, 'dest_postcode', 'to postcode', 'receiver postcode'), `destination postcode on row ${i + 2}`)),
    receiver: mapped(r, map, 'receiver', 'receiver name', 'customer'),
    items: intOrNull(mapped(r, map, 'items', 'pieces', 'cartons')) || 1,
    dead_kg: numOrNull(required(mapped(r, map, 'dead_kg', 'weight', 'kg'), `weight on row ${i + 2}`)),
    cubic_m3: numOrNull(mapped(r, map, 'cubic_m3', 'cubic', 'm3')) || 0,
    services: mapped(r, map, 'services', 'options').split(/[|;]/).map((s) => s.trim().toUpperCase()).filter(Boolean),
    cost_centre: mapped(r, map, 'cost_centre', 'cost centre', 'branch') || 'GENERAL',
    order_ref: mapped(r, map, 'order_ref', 'order', 'reference'),
  }));
  if (dryRun) return { carrier: c.code, rows: parsed.length, dry_run: true, first: parsed.slice(0, 3) };
  return transaction(db, actor, async () => {
    const batchId = await batch(db, 'consignments', file, rows.length, parsed.length, actor);
    let loaded = 0;
    for (const k of parsed) {
      const r = await db.query(
        `insert into consignments (carrier_id, connote, ship_date, delivered_on, origin_postcode, dest_postcode, receiver, items, dead_kg, cubic_m3, services, cost_centre, order_ref, import_batch_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (carrier_id, connote) do nothing returning id`,
        [c.id, k.connote, k.ship_date, k.delivered_on, k.origin_postcode, k.dest_postcode, k.receiver, k.items, k.dead_kg, k.cubic_m3, k.services, k.cost_centre, k.order_ref, batchId]);
      loaded += r.length;
    }
    await refreshEstimates(db);
    return { carrier: c.code, rows: parsed.length, loaded, already_there: parsed.length - loaded, batch: batchId };
  });
}

// A rate schedule: origin_zone, dest_zone, basic, per_kg, min. A new card never overwrites an old one.
export async function importRates(db, file, { carrier, card, service, from, to, cubic = 250, dryRun = false, actor, map: mapFile }) {
  const c = await resolve(db, 'carriers', required(carrier, '--carrier=CODE'));
  const [car] = await db.query('select * from carriers where id = $1', [c.id]);
  const { rows, map } = readRows(file, mapFile);
  const lanes = rows.map((r, i) => ({
    origin_zone: required(mapped(r, map, 'origin_zone', 'from zone', 'origin'), `origin zone on row ${i + 2}`).toUpperCase(),
    dest_zone: required(mapped(r, map, 'dest_zone', 'to zone', 'destination'), `destination zone on row ${i + 2}`).toUpperCase(),
    basic_cents: cents(mapped(r, map, 'basic', 'basic charge') || '0'),
    per_kg_cents: cents(mapped(r, map, 'per_kg', 'rate per kg', 'kg rate') || '0'),
    min_cents: cents(mapped(r, map, 'min', 'minimum', 'minimum charge') || '0'),
  }));
  const meta = { carrier: c.code, card: required(card, '--card=CODE'), service: required(service, '--service=NAME'), from: isoDate(from, '--from'), to: isoDate(to, '--to'), lanes: lanes.length };
  if (dryRun) return { ...meta, dry_run: true, first: lanes.slice(0, 3) };
  return transaction(db, actor, async () => {
    const [rc] = await db.query('insert into rate_cards (carrier_id, code, service, valid_from, valid_to, currency, cubic_factor, tax_rate_bps, source_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
      [c.id, meta.card, meta.service, meta.from, meta.to, car.currency, Number(cubic), car.country === 'AU' ? 1000 : 1500, String(file).split(/[\\/]/).pop()]);
    for (const l of lanes) await db.query('insert into rate_lines (rate_card_id, origin_zone, dest_zone, basic_cents, per_kg_cents, min_cents) values ($1,$2,$3,$4,$5,$6)', [rc.id, l.origin_zone, l.dest_zone, l.basic_cents, l.per_kg_cents, l.min_cents]);
    await batch(db, 'rates', file, rows.length, lanes.length, actor);
    return { ...meta, next: 'Add agreed surcharges with add surcharge, then audit --again' };
  });
}

// ---------------------------------------------------------------- add

export async function add(db, kind, data) {
  if (kind === 'carrier') {
    return db.query('insert into carriers (code, name, account_no, tax_number, country, currency, payment_terms_days, dispute_window_days, small_business, contact_email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning code, name',
      [required(data.code, 'code').toUpperCase(), required(data.name, 'name'), data.account_no || '', data.tax_number || '', data.country || 'NZ', data.currency || (data.country === 'AU' ? 'AUD' : 'NZD'), data.payment_terms_days ?? 20, data.dispute_window_days ?? 30, Boolean(data.small_business), data.contact_email || '']);
  }
  if (kind === 'zone') {
    const c = await resolve(db, 'carriers', data.carrier);
    return db.query('insert into zones (carrier_id, postcode_from, postcode_to, zone) values ($1,$2,$3,$4) returning zone, postcode_from, postcode_to', [c.id, Number(data.postcode_from), Number(data.postcode_to), required(data.zone, 'zone').toUpperCase()]);
  }
  if (kind === 'surcharge') {
    const r = await resolve(db, 'rate_cards', data.rate_card);
    return db.query('insert into surcharges (rate_card_id, code, description, amount_cents, needs_service) values ($1,$2,$3,$4,$5) returning code, amount_cents', [r.id, required(data.code, 'code').toUpperCase(), required(data.description, 'description'), cents(String(data.amount)), data.needs_service !== false]);
  }
  if (kind === 'fuel-levy') {
    const c = await resolve(db, 'carriers', data.carrier);
    return db.query('insert into fuel_levies (carrier_id, month, levy_bps, source_ref) values ($1, $2, $3, $4) on conflict (carrier_id, month) do update set levy_bps = excluded.levy_bps, source_ref = excluded.source_ref returning month, levy_bps', [c.id, isoDate(data.month, 'month (first day, YYYY-MM-01)'), Math.round(Number(data.percent) * 100), data.source_ref || '']);
  }
  if (kind === 'setting') {
    return db.query('insert into settings (key, value, note) values ($1, $2, $3) on conflict (key) do update set value = excluded.value, note = excluded.note returning key, value', [required(data.key, 'key'), String(required(data.value, 'value')), data.note || '']);
  }
  throw new Error('Add one of: carrier, zone, surcharge, fuel-levy, setting');
}
