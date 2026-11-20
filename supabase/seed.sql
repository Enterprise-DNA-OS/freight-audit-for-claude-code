-- Demo data: Harbour Homewares Demo, an Auckland wholesaler shipping with three fictional carriers.
-- Dates are relative to today so there is always something overdue, closing or unbilled.
-- Idempotent: a second run does nothing.
do $$
declare
  d0 date := current_date;
begin
  if exists (select 1 from carriers where code = 'RL') then return; end if;

  insert into settings (key, value, note) values
    ('tolerance_cents', '200', 'Differences of $2.00 or less are not raised'),
    ('weight_tolerance_pct', '3', 'Billed weight may exceed ours by 3% before it is raised');

  insert into carriers (code, name, account_no, tax_number, country, currency, payment_terms_days, dispute_window_days, small_business, contact_email) values
    ('RL', 'Demo Road Linehaul', 'HH-20418', '123-456-789', 'NZ', 'NZD', 20, 30, false, 'accounts@roadlinehaul.example'),
    ('OC', 'Demo Overnight Couriers', 'OC-77120', '111-222-333', 'NZ', 'NZD', 20, 30, false, 'billing@overnight.example'),
    ('PP', 'Demo Pallet Partners', 'PP-0042', '98-765-432', 'NZ', 'NZD', 30, 30, true, 'office@palletpartners.example');

  insert into zones (carrier_id, postcode_from, postcode_to, zone)
  select c.id, z.f, z.t, z.zone from carriers c
  cross join (values (600, 2699, 'AKL'), (3200, 3299, 'HAM'), (5000, 6999, 'WLG'), (7600, 8999, 'CHC')) as z(f, t, zone);

  insert into rate_cards (carrier_id, code, service, valid_from, valid_to, currency, cubic_factor, source_ref) values
    ((select id from carriers where code = 'RL'), 'RL-2026', 'Road general freight', d0 - 300, d0 + 20, 'NZD', 250, 'Signed schedule, RL contract clause 4'),
    ((select id from carriers where code = 'OC'), 'OC-2026', 'Overnight courier', d0 - 100, d0 + 265, 'NZD', 250, 'OC account rate letter'),
    ((select id from carriers where code = 'PP'), 'PP-2026', 'Pallet freight', d0 - 60, d0 + 300, 'NZD', 250, 'PP quote accepted by email');

  insert into rate_lines (rate_card_id, origin_zone, dest_zone, basic_cents, per_kg_cents, min_cents)
  select r.id, l.o, l.d, l.basic, l.kg, l.mn from rate_cards r
  join (values
    ('RL-2026', 'AKL', 'WLG', 1500, 42, 3500), ('RL-2026', 'AKL', 'CHC', 1800, 55, 4000),
    ('RL-2026', 'AKL', 'HAM', 900, 18, 2200), ('RL-2026', 'WLG', 'AKL', 1500, 42, 3500),
    ('OC-2026', 'AKL', 'WLG', 850, 95, 1200), ('OC-2026', 'AKL', 'CHC', 950, 120, 1400),
    ('OC-2026', 'AKL', 'HAM', 600, 60, 900),
    ('PP-2026', 'AKL', 'CHC', 4500, 30, 9000), ('PP-2026', 'AKL', 'WLG', 4000, 25, 8000)
  ) as l(card, o, d, basic, kg, mn) on l.card = r.code;

  insert into surcharges (rate_card_id, code, description, amount_cents, needs_service)
  select r.id, s.code, s.description, s.amount, true from rate_cards r
  join (values
    ('RL-2026', 'TAILGATE', 'Tailgate truck at delivery', 4500), ('RL-2026', 'RESIDENTIAL', 'Residential delivery', 1200),
    ('RL-2026', 'BOOKIN', 'Booked delivery time', 1500),
    ('OC-2026', 'RESIDENTIAL', 'Residential delivery', 450), ('OC-2026', 'DG', 'Dangerous goods', 2500),
    ('PP-2026', 'TAILGATE', 'Tailgate truck at delivery', 6000), ('PP-2026', 'BOOKIN', 'Booked delivery time', 2000)
  ) as s(card, code, description, amount) on s.card = r.code;

  insert into fuel_levies (carrier_id, month, levy_bps, source_ref)
  select c.id, (date_trunc('month', d0) - make_interval(months => m))::date,
         case c.code when 'RL' then 1850 when 'OC' then 1600 else 1500 end, 'Carrier fuel levy page'
  from carriers c cross join generate_series(0, 5) as m;

  insert into consignments (carrier_id, connote, ship_date, delivered_on, origin_postcode, dest_postcode, receiver, items, dead_kg, cubic_m3, services, cost_centre, order_ref)
  select (select id from carriers where code = k.carrier), k.connote, d0 + k.shipped, d0 + k.shipped + 2, k.o, k.d, k.receiver, k.items, k.kg, k.m3, k.services::text[], k.cc, k.ref
  from (values
    ('RL', 'RL0950', -75, 2104, 6011, 'Capital Kitchens', 4, 100.0, 0.0, '{}', 'TRADE', 'SO-4410'),
    ('RL', 'RL0951', -74, 2104, 3204, 'Waikato Home Centre', 2, 40.0, 0.0, '{}', 'RETAIL', 'SO-4415'),
    ('RL', 'RL0990', -60, 2104, 8011, 'Garden City Interiors', 6, 150.0, 0.2, '{}', 'TRADE', 'SO-4502'),
    ('RL', 'RL1001', -30, 2104, 6011, 'Capital Kitchens', 12, 300.0, 0.8, '{}', 'TRADE', 'SO-4630'),
    ('RL', 'RL1002', -29, 2104, 8011, 'Garden City Interiors', 5, 120.0, 0.9, '{}', 'TRADE', 'SO-4633'),
    ('RL', 'RL1003', -28, 2104, 3204, 'Waikato Home Centre', 3, 80.0, 0.1, '{TAILGATE}', 'RETAIL', 'SO-4640'),
    ('RL', 'RL1004', -27, 6011, 2104, 'Returns from Capital Kitchens', 10, 500.0, 1.0, '{}', 'RETAIL', 'RMA-118'),
    ('RL', 'RL1005', -10, 2104, 6011, 'Harbour Homewares Wellington', 8, 200.0, 0.5, '{}', 'RETAIL', 'TR-0912'),
    ('OC', 'OC5001', -45, 2104, 6011, 'J. Rangi', 1, 5.0, 0.02, '{RESIDENTIAL}', 'ONLINE', 'WEB-30311'),
    ('OC', 'OC5002', -44, 2104, 3204, 'Hamilton Hardware', 1, 3.0, 0.01, '{}', 'TRADE', 'SO-4590'),
    ('OC', 'OC5010', -14, 2104, 6011, 'M. Chen', 2, 12.0, 0.06, '{}', 'ONLINE', 'WEB-30420'),
    ('OC', 'OC5011', -13, 2104, 8011, 'A. Taylor', 1, 8.0, 0.02, '{RESIDENTIAL}', 'ONLINE', 'WEB-30428'),
    ('OC', 'OC5012', -12, 2104, 3204, 'Hamilton Hardware', 1, 2.0, 0.0, '{}', 'TRADE', 'SO-4688'),
    ('OC', 'OC5013', -5, 2104, 6011, 'S. Patel', 1, 4.0, 0.01, '{}', 'ONLINE', 'WEB-30477'),
    ('PP', 'PP7001', -40, 2104, 8011, 'Garden City Interiors', 2, 600.0, 2.4, '{BOOKIN}', 'TRADE', 'SO-4570'),
    ('PP', 'PP7002', -36, 2104, 6011, 'Capital Kitchens', 1, 300.0, 1.0, '{}', 'TRADE', 'SO-4582')
  ) as k(carrier, connote, shipped, o, d, receiver, items, kg, m3, services, cc, ref);

  -- Invoices. Older ones were audited and settled; three new ones wait for the audit.
  insert into invoices (carrier_id, invoice_no, invoice_date, due_date, currency, total_ex_cents, gst_cents, supplier_tax_number, status, audited_at, approved_at, approved_by, approval_evidence)
  select (select id from carriers where code = i.carrier), i.no, d0 + i.dated, d0 + i.dated + i.terms, 'NZD', 0, 0, i.tax, i.status,
         case when i.status = 'received' then null else now() end,
         case when i.status = 'approved' then now() end,
         case when i.status = 'approved' then 'Demo Accounts' end,
         case when i.status = 'approved' then 'Checked against POD batch and rate card' end
  from (values
    ('RL', 'RL-INV-5004', -60, 20, '123-456-789', 'approved'),
    ('RL', 'RL-INV-5101', -24, 20, '123-456-789', 'received'),
    ('OC', 'OC-88102', -40, 20, '111-222-333', 'approved'),
    ('OC', 'OC-88213', -10, 20, '', 'received'),
    ('PP', 'PP-3301', -35, 30, '98-765-432', 'disputed'),
    ('PP', 'PP-3340', -33, 30, '98-765-432', 'received')
  ) as i(carrier, no, dated, terms, tax, status);

  insert into invoice_lines (invoice_id, line_no, connote, kind, charge_code, description, billed_kg, origin_postcode, dest_postcode, amount_cents, expected_cents)
  select (select id from invoices where invoice_no = l.inv), l.n, l.connote, l.kind, l.code, l.description, l.kg, l.o, l.d, l.amount, l.expected
  from (values
    ('RL-INV-5004', 1, 'RL0950', 'freight', '', 'Road freight', 100.0, 2104, 6011, 5700, 5700),
    ('RL-INV-5004', 2, 'RL0950', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 1055, 1055),
    ('RL-INV-5004', 3, 'RL0951', 'freight', '', 'Road freight', 40.0, 2104, 3204, 2200, 2200),
    ('RL-INV-5004', 4, 'RL0951', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 407, 407),
    ('RL-INV-5004', 5, 'RL0951', 'surcharge', 'BOOKIN', 'Booked delivery', null, null, null, 1500, 0),
    ('RL-INV-5101', 1, 'RL1001', 'freight', '', 'Road freight', 380.0, 2104, 6011, 17460, null),
    ('RL-INV-5101', 2, 'RL1001', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 3230, null),
    ('RL-INV-5101', 3, 'RL1002', 'freight', '', 'Road freight', 225.0, 2104, 8011, 14175, null),
    ('RL-INV-5101', 4, 'RL1002', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 2622, null),
    ('RL-INV-5101', 5, 'RL1002', 'surcharge', 'TAILGATE', 'Tailgate delivery', null, null, null, 4500, null),
    ('RL-INV-5101', 6, 'RL1003', 'freight', '', 'Road freight', 80.0, 2104, 3204, 2340, null),
    ('RL-INV-5101', 7, 'RL1003', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 433, null),
    ('RL-INV-5101', 8, 'RL1003', 'surcharge', 'TAILGATE', 'Tailgate delivery', null, null, null, 4500, null),
    ('RL-INV-5101', 9, 'RL1004', 'freight', '', 'Road freight', 500.0, 6011, 2104, 22500, null),
    ('RL-INV-5101', 10, 'RL1004', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 4163, null),
    ('OC-88102', 1, 'OC5001', 'freight', '', 'Overnight', 5.0, 2104, 6011, 1325, 1325),
    ('OC-88102', 2, 'OC5001', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 212, 212),
    ('OC-88102', 3, 'OC5002', 'freight', '', 'Overnight', 3.0, 2104, 3204, 900, 900),
    ('OC-88102', 4, 'OC5002', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 144, 144),
    ('OC-88213', 1, 'OC5001', 'freight', '', 'Overnight', 5.0, 2104, 6011, 1325, null),
    ('OC-88213', 2, 'OC5001', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 212, null),
    ('OC-88213', 3, 'OC5010', 'freight', '', 'Overnight', 15.0, 2104, 8011, 2750, null),
    ('OC-88213', 4, 'OC5010', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 440, null),
    ('OC-88213', 5, 'OC5011', 'freight', '', 'Overnight', 8.0, 2104, 8011, 1910, null),
    ('OC-88213', 6, 'OC5011', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 306, null),
    ('OC-88213', 7, 'OC5011', 'surcharge', 'RESIDENTIAL', 'Residential delivery', null, null, null, 450, null),
    ('OC-88213', 8, 'OC5012', 'freight', '', 'Overnight', 2.0, 2104, 3204, 900, null),
    ('OC-88213', 9, 'OC5012', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 144, null),
    ('OC-88213', 10, 'OC9999', 'freight', '', 'Overnight', 6.0, 2104, 6011, 1500, null),
    ('PP-3301', 1, 'PP7001', 'freight', '', 'Pallet freight', 600.0, 2104, 8011, 22500, 22500),
    ('PP-3301', 2, 'PP7001', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 3375, 3375),
    ('PP-3301', 3, 'PP7001', 'surcharge', 'BOOKIN', 'Booked delivery', null, null, null, 2000, 2000),
    ('PP-3301', 4, 'PP7001', 'other', 'WAITING', 'Waiting time at delivery', null, null, null, 3500, 0),
    ('PP-3340', 1, 'PP7002', 'freight', '', 'Pallet freight', 300.0, 2104, 6011, 11500, null),
    ('PP-3340', 2, 'PP7002', 'fuel', 'FUEL', 'Fuel levy', null, null, null, 1725, null)
  ) as l(inv, n, connote, kind, code, description, kg, o, d, amount, expected);

  update invoices i set total_ex_cents = s.total, gst_cents = round(s.total * 0.15)
  from (select invoice_id, sum(amount_cents) as total from invoice_lines group by invoice_id) s where s.invoice_id = i.id;
  update invoices set gst_cents = gst_cents + 500 where invoice_no = 'PP-3340';  -- GST billed wrong

  -- Two earlier disputes: one fully credited, one waiting on the carrier.
  insert into disputes (code, carrier_id, invoice_id, raised_on, raised_by, claimed_cents, credited_cents, status, closed_on, carrier_ref) values
    ('D-1001', (select id from carriers where code = 'PP'), (select id from invoices where invoice_no = 'PP-3301'), d0 - 30, 'Demo Accounts', 3500, 0, 'open', null, ''),
    ('D-1002', (select id from carriers where code = 'RL'), (select id from invoices where invoice_no = 'RL-INV-5004'), d0 - 55, 'Demo Accounts', 1500, 1500, 'credited', d0 - 45, 'RL case 7781');
  perform setval('dispute_seq', 1002);

  insert into findings (invoice_id, invoice_line_id, rule, detail, billed_cents, expected_cents, variance_cents, decision, decided_by, decided_at, dispute_id)
  select i.id, l.id, f.rule, f.detail, l.amount_cents, 0, l.amount_cents, 'disputed', 'Demo Accounts', now(), (select id from disputes where code = f.dispute)
  from (values
    ('PP-3301', 4, 'OTHER_CHARGE', 'Charge not covered by the rate card: Waiting time at delivery', 'D-1001'),
    ('RL-INV-5004', 5, 'SURCHARGE_NOT_REQUESTED', 'BOOKIN billed but the consignment did not ask for it', 'D-1002')
  ) as f(inv, n, rule, detail, dispute)
  join invoices i on i.invoice_no = f.inv
  join invoice_lines l on l.invoice_id = i.id and l.line_no = f.n;

  insert into credit_notes (carrier_id, dispute_id, credit_no, credit_date, amount_cents) values
    ((select id from carriers where code = 'RL'), (select id from disputes where code = 'D-1002'), 'CN-RL-221', d0 - 45, 1500);

  insert into notes (dispute_id, actor, body) values
    ((select id from disputes where code = 'D-1001'), 'Demo Accounts', 'Emailed PP accounts with the delivery booking showing no wait was agreed. No reply yet.');
end $$;
