-- Freight Audit for Claude Code: the schema.
-- A shipper's record of what each carrier agreed to charge (rate cards, zones, fuel levies,
-- surcharges), what was actually sent (consignments) and what the carrier billed (invoices).
-- The audit compares the three, line by line, and keeps every finding, dispute and credit note.
-- Money is stored in integer cents. Percentages are stored in basis points (1500 = 15.00%).

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table settings (
  key text primary key,
  value text not null,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table carriers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_no text not null default '',
  tax_number text not null default '',            -- GST number (NZ) or ABN (AU) printed on its tax invoices
  country text not null default 'NZ' check (country in ('NZ', 'AU')),
  currency text not null default 'NZD',
  payment_terms_days int not null default 20 check (payment_terms_days between 0 and 120),
  dispute_window_days int not null default 30 check (dispute_window_days between 1 and 365),
  small_business boolean not null default false,  -- for payment-time reporting
  contact_email text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Postcode ranges to the carrier's own zone names.
create table zones (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  postcode_from int not null,
  postcode_to int not null,
  zone text not null,
  check (postcode_to >= postcode_from),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index zones_lookup on zones (carrier_id, postcode_from, postcode_to);

create table rate_cards (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  code text not null unique,
  service text not null,                           -- road, overnight courier, pallet
  valid_from date not null,
  valid_to date not null,
  currency text not null default 'NZD',
  cubic_factor numeric(8,2) not null default 250 check (cubic_factor >= 0),  -- kg charged per cubic metre
  tax_rate_bps int not null default 1500 check (tax_rate_bps between 0 and 5000),
  source_ref text not null default '',             -- the signed contract or schedule this came from
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to >= valid_from)
);

create table rate_lines (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references rate_cards(id) on delete cascade,
  origin_zone text not null,
  dest_zone text not null,
  basic_cents bigint not null default 0 check (basic_cents >= 0),
  per_kg_cents bigint not null default 0 check (per_kg_cents >= 0),
  min_cents bigint not null default 0 check (min_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rate_card_id, origin_zone, dest_zone)
);

-- Agreed surcharges. Anything billed that is not on this list is a finding.
create table surcharges (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references rate_cards(id) on delete cascade,
  code text not null,
  description text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  needs_service boolean not null default true,     -- only payable when the consignment asked for it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rate_card_id, code)
);

-- The carrier's published fuel levy for each month, as a percentage of freight.
create table fuel_levies (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  levy_bps int not null check (levy_bps between 0 and 10000),
  source_ref text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (carrier_id, month)
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  source_file text not null,
  rows_read int not null default 0,
  rows_loaded int not null default 0,
  actor text not null,
  created_at timestamptz not null default now()
);

-- What we actually sent, from the shipping or order system.
create table consignments (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id),
  connote text not null,
  ship_date date not null,
  delivered_on date,
  origin_postcode int not null,
  dest_postcode int not null,
  receiver text not null default '',
  items int not null default 1 check (items > 0),
  dead_kg numeric(10,2) not null check (dead_kg > 0),
  cubic_m3 numeric(10,4) not null default 0 check (cubic_m3 >= 0),
  services text[] not null default '{}',           -- TAILGATE, RESIDENTIAL, DG, BOOKIN ...
  cost_centre text not null default 'GENERAL',
  order_ref text not null default '',
  estimate_cents bigint,                           -- what the rate card says this should cost
  estimate_note text not null default '',
  import_batch_id uuid references import_batches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (carrier_id, connote)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id),
  invoice_no text not null,
  invoice_date date not null,
  due_date date not null,
  currency text not null default 'NZD',
  total_ex_cents bigint not null,
  gst_cents bigint not null,
  supplier_tax_number text not null default '',
  status text not null default 'received' check (status in ('received', 'on_hold', 'approved', 'disputed', 'closed')),
  audited_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  approval_evidence text,
  import_batch_id uuid references import_batches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (carrier_id, invoice_no)
);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  line_no int not null,
  connote text not null default '',
  kind text not null check (kind in ('freight', 'fuel', 'surcharge', 'other')),
  charge_code text not null default '',
  description text not null default '',
  billed_kg numeric(10,2),
  origin_postcode int,
  dest_postcode int,
  amount_cents bigint not null,
  expected_cents bigint,                           -- set by the audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, line_no)
);
create index invoice_lines_connote on invoice_lines (connote);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  carrier_id uuid not null references carriers(id),
  invoice_id uuid not null references invoices(id),
  raised_on date not null default current_date,
  raised_by text not null,
  claimed_cents bigint not null check (claimed_cents > 0),
  credited_cents bigint not null default 0 check (credited_cents >= 0),
  status text not null default 'open' check (status in ('open', 'credited', 'part_credited', 'rejected', 'withdrawn')),
  closed_on date,
  carrier_ref text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per check that failed on an invoice line (or on the invoice itself).
create table findings (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  invoice_line_id uuid references invoice_lines(id) on delete cascade,
  rule text not null,
  detail text not null,
  billed_cents bigint not null default 0,
  expected_cents bigint not null default 0,
  variance_cents bigint not null default 0,        -- billed minus expected; positive means overcharged
  decision text not null default 'open' check (decision in ('open', 'accepted', 'disputed', 'waived')),
  decided_by text,
  decided_at timestamptz,
  decision_note text not null default '',
  dispute_id uuid references disputes(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, invoice_line_id, rule)
);

create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id),
  dispute_id uuid references disputes(id),
  credit_no text not null,
  credit_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (carrier_id, credit_no)
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade,
  dispute_id uuid references disputes(id) on delete cascade,
  actor text not null,
  body text not null,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['settings','carriers','zones','rate_cards','rate_lines','surcharges','fuel_levies','consignments','invoices','invoice_lines','disputes','findings','credit_notes'] loop
    execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

create sequence dispute_seq start 1001;

-- ---------------------------------------------------------------- views

-- Every invoice with its billed, expected, disputed and credited money.
create view invoice_audit as
select i.id, i.invoice_no, c.code as carrier, i.invoice_date, i.due_date, i.status, i.currency,
       i.total_ex_cents as billed_cents,
       coalesce(sum(l.expected_cents), 0)::bigint as expected_cents,
       (i.total_ex_cents - coalesce(sum(l.expected_cents), 0))::bigint as variance_cents,
       (select count(*) from findings f where f.invoice_id = i.id and f.decision = 'open')::int as open_findings,
       (select coalesce(sum(variance_cents), 0) from findings f where f.invoice_id = i.id and f.decision = 'open')::bigint as open_variance_cents,
       (i.invoice_date + c.dispute_window_days) as dispute_by,
       ((i.invoice_date + c.dispute_window_days) - current_date) as days_to_dispute
from invoices i
join carriers c on c.id = i.carrier_id
left join invoice_lines l on l.invoice_id = i.id
group by i.id, c.code, c.dispute_window_days;

-- Open findings with the window left to dispute them.
create view open_findings as
select f.id, i.invoice_no, c.code as carrier, coalesce(l.connote, '') as connote, f.rule, f.detail,
       i.currency, f.billed_cents, f.expected_cents, f.variance_cents,
       (i.invoice_date + c.dispute_window_days) as dispute_by,
       ((i.invoice_date + c.dispute_window_days) - current_date) as days_left
from findings f
join invoices i on i.id = f.invoice_id
join carriers c on c.id = i.carrier_id
left join invoice_lines l on l.id = f.invoice_line_id
where f.decision = 'open';

create view dispute_aging as
select d.code, c.code as carrier, i.invoice_no, d.raised_on, d.status, i.currency,
       d.claimed_cents, d.credited_cents, (d.claimed_cents - d.credited_cents) as outstanding_cents,
       (current_date - d.raised_on) as days_open, d.carrier_ref
from disputes d
join carriers c on c.id = d.carrier_id
join invoices i on i.id = d.invoice_id;

-- Sent but not yet billed: the month-end freight accrual.
create view unbilled as
select k.connote, c.code as carrier, k.ship_date, k.cost_centre, c.currency, k.estimate_cents,
       (current_date - k.ship_date) as days_since_shipped, k.estimate_note
from consignments k
join carriers c on c.id = k.carrier_id
where not exists (
  select 1 from invoice_lines l join invoices i on i.id = l.invoice_id
  where i.carrier_id = k.carrier_id and l.connote = k.connote
);

-- What each carrier got wrong, in money.
create view carrier_scorecard as
select c.code as carrier, c.name, c.currency,
       count(distinct i.id)::int as invoices,
       count(distinct l.id)::int as lines,
       count(distinct f.invoice_line_id) filter (where f.rule <> 'TAX_INVOICE')::int as lines_with_findings,
       coalesce(round(100.0 * count(distinct f.invoice_line_id) / nullif(count(distinct l.id), 0), 1), 0) as error_rate_pct,
       coalesce(sum(f.variance_cents) filter (where f.variance_cents > 0), 0)::bigint as overbilled_cents,
       coalesce((select sum(n.amount_cents) from credit_notes n where n.carrier_id = c.id), 0)::bigint as credited_cents
from carriers c
left join invoices i on i.carrier_id = c.id
left join invoice_lines l on l.invoice_id = i.id
left join findings f on f.invoice_line_id = l.id
group by c.id;

-- Billed freight cost by cost centre, month and carrier (credits are tracked on disputes).
create view cost_allocation as
select to_char(k.ship_date, 'YYYY-MM') as month, k.cost_centre, c.code as carrier, i.currency,
       count(distinct k.id)::int as consignments,
       sum(l.amount_cents)::bigint as billed_cents
from invoice_lines l
join invoices i on i.id = l.invoice_id
join carriers c on c.id = i.carrier_id
join consignments k on k.carrier_id = i.carrier_id and k.connote = l.connote
group by 1, 2, 3, 4;

create view rate_card_expiry as
select r.code, c.code as carrier, r.service, r.valid_from, r.valid_to, (r.valid_to - current_date) as days_left,
       (select count(*) from rate_lines x where x.rate_card_id = r.id)::int as lanes
from rate_cards r join carriers c on c.id = r.carrier_id;

-- One list of what needs a person this week.
create view attention as
select case when days_to_dispute < 0 then 'dispute window closed' else 'dispute window closing' end as item, invoice_no || ' ' || carrier as what,
       'Open findings worth ' || currency || ' ' || to_char(open_variance_cents / 100.0, 'FM999990.00') as why,
       dispute_by as due
from invoice_audit where open_findings > 0 and days_to_dispute <= 10
union all
select 'invoice due, not approved', invoice_no || ' ' || carrier, 'Status ' || status, due_date
from invoice_audit where status in ('received', 'on_hold') and due_date <= current_date + 7
union all
select 'dispute with no answer', code || ' ' || carrier, days_open || ' days open, ' || currency || ' ' || to_char(outstanding_cents / 100.0, 'FM999990.00') || ' outstanding', raised_on + 21
from dispute_aging where status = 'open' and days_open > 21
union all
select 'shipped, never billed', connote || ' ' || carrier, days_since_shipped || ' days since shipping', ship_date + 45
from unbilled where days_since_shipped > 45
union all
select 'rate card expiring', code || ' ' || carrier, days_left || ' days left', valid_to
from rate_card_expiry where days_left <= 30;

-- Record checks against the rules in docs/compliance.md. They support a person's review;
-- they do not certify compliance.
create view compliance_findings as
select 'TAX_INVOICE_DETAILS' as rule, i.invoice_no as record, c.code as carrier,
       'No supplier GST number or ABN recorded on the tax invoice' as finding
from invoices i join carriers c on c.id = i.carrier_id
where trim(i.supplier_tax_number) = ''
union all
select 'GST_AMOUNT', i.invoice_no, c.code,
       'GST billed ' || to_char(i.gst_cents / 100.0, 'FM999990.00') || ', expected ' ||
       to_char(round(i.total_ex_cents * (case c.country when 'AU' then 1000 else 1500 end) / 10000.0) / 100.0, 'FM999990.00')
from invoices i join carriers c on c.id = i.carrier_id
where abs(i.gst_cents - round(i.total_ex_cents * (case c.country when 'AU' then 1000 else 1500 end) / 10000.0)) > 2
union all
select 'PAYMENT_TIMES_SMALL_BUSINESS', i.invoice_no, c.code,
       'Small business carrier, due ' || i.due_date || ', still ' || i.status
from invoices i join carriers c on c.id = i.carrier_id
where c.small_business and i.status in ('received', 'on_hold') and i.due_date < current_date
union all
select 'DISPUTE_WINDOW', i.invoice_no, c.code,
       'Open findings past the contract dispute window (' || c.dispute_window_days || ' days)'
from invoices i join carriers c on c.id = i.carrier_id
where exists (select 1 from findings f where f.invoice_id = i.id and f.decision = 'open' and f.variance_cents > 0)
  and i.invoice_date + c.dispute_window_days < current_date
union all
select 'APPROVAL_EVIDENCE', i.invoice_no, c.code, 'Approved with no evidence reference recorded'
from invoices i join carriers c on c.id = i.carrier_id
where i.status = 'approved' and coalesce(trim(i.approval_evidence), '') = '';
