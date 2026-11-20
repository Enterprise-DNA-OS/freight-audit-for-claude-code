<h1 align="center">Freight Audit for Claude Code</h1>

<p align="center">
  <strong>The open-source freight audit that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your nShift Audit data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=nshift-audit">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/nshift-audit?utm_source=github&utm_medium=readme&utm_campaign=nshift-audit">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-nshift-audit">Instead of nShift Audit</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Freight Audit for Claude Code does the job you pay nShift Audit for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query and answers questions across your rate cards, consignments and invoices that a fixed dashboard does not chart.

nShift does not publish a price for Audit. Its [Audit page](https://nshift.com/audit) says the quote is sized on your freight operation and pitches it at businesses with at least EUR 1 million of annual freight spend (checked 20 November 2026). Ask for your own quote and put it next to this.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=nshift-audit).

It is for a manufacturer, wholesaler or retailer that pays several road, courier and pallet carriers and wants every invoice line checked before it is paid. It holds your rate cards, postcode zones, monthly fuel levies, agreed surcharges and consignments; checks each invoice line for duplicates, unknown connotes, wrong zones, overweight billing, wrong rates, wrong fuel levy and surcharges nobody asked for; and keeps the findings, disputes, credit notes, unbilled freight accrual and cost by cost centre in one place. Tax invoice details and GST are checked too.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/freight-audit-for-claude-code.git
cd freight-audit-for-claude-code
npm install
npm run demo
```

`npm run demo` builds a throwaway database under `.data/`, loads a fictional Auckland wholesaler with three carriers, audits its invoices and writes three dashboards and the documents. Then open the folder in Claude Code and type `/attention`, then `/exceptions`.

For a working copy of the demo: `npm run migrate && npm run seed`, then `npm run freight -- weekly-review`. Start a real database with `npm run migrate` only; never seed it.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/add` | Add a carrier, a postcode zone range, an agreed surcharge, a fuel levy or a setting. |
| `/approve` | Clear an audited invoice for payment once every finding is decided, recording who checked it and what was held back in dispute. |
| `/attention` | What needs a person this week: dispute windows closing, invoices due but not cleared, disputes with no answer, freight shipped but never billed, rate cards running out. |
| `/audit` | Check every new carrier invoice, line by line, against the agreed rate card, the fuel levy for the month, the surcharge schedule and our own consignment records. |
| `/carrier-review` | Prepare for a rate review with one carrier: its error rate, surcharges, lane costs, disputes and rate card expiry, in one brief. |
| `/compliance` | Check the invoice records against the rules in docs/compliance.md (tax invoice details, GST, small business payment times, dispute windows, approval evidence) and report what needs fixing, rule cited. |
| `/credit` | Record a credit note a carrier issued against a dispute and match it. |
| `/customise` | Make this system yours in plain language. Add a field, rename stages, change a rule, add a column to a document. Writes the migration, applies it, updates the commands that touch it. |
| `/decide` | Record a decision on one finding: accepted (the carrier is right) or waived (not worth disputing), with the reason. |
| `/dispute` | Raise a dispute for every open overcharge on an invoice, then draft the credit request to the carrier. |
| `/disputes` | Dispute aging: what each carrier still owes back, how long it has been open, and who to chase. |
| `/draft-dispute` | Draft the credit request letter for one dispute, with every line, the reason and the agreed amount. |
| `/draft-weekly-review` | Save the weekly review as a draft file for the operator to read or forward. |
| `/exceptions` | List every open audit finding with the money at stake and the days left to dispute it. |
| `/export` | Export every record to one JSON file the operator owns. |
| `/fuel-levy` | Record a carrier's fuel levy for a month, then re-check open invoices against it. |
| `/import` | Bring records in from CSV: carrier invoices, our consignments, rate cards, or an nShift Audit export. |
| `/insights` | Ten questions about freight spend that a carrier portal does not answer, run against your records. |
| `/invoice` | Show one carrier invoice in full: every line with billed and agreed amounts, the findings, decisions and notes. |
| `/invoices` | List carrier invoices with billed versus agreed totals, status and dispute deadline. |
| `/lane-cost` | Freight cost per kilo by carrier and lane, from billed invoices. |
| `/log` | Add a note to an invoice or a dispute: a call with the carrier, a promise, a reference. |
| `/month-end` | The month-end freight pack: the accrual for shipped but unbilled freight by cost centre, and billed freight by cost centre. |
| `/new-view` | Add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view`. |
| `/rate-cards` | Rate cards on file, their validity and lane count, and loading a new card when a carrier sends one. |
| `/scorecard` | Carrier scorecard: invoices, error rate, money overbilled and money credited back, per carrier. |
| `/surcharges` | Which surcharges each carrier bills, how often, for how much, and how many were challenged. |
| `/unbilled` | Freight we have shipped that no carrier has billed yet, with the estimate from the rate card. |
| `/weekly-review` | The Monday review: what needs attention, open findings, disputes waiting on carriers and the carrier scorecard. |

Everything runs through one CLI, `npm run freight -- --help`. Every command takes `--json`. Names match partly and case-insensitively; an ambiguous name lists the candidates and exits 1. No command sends email, pays a carrier or deletes a record.

`npm run view` writes three read-only pages (this week, carrier scorecard, month end) and `npm run docs` writes a credit request for each open dispute and an audit report for each invoice, in the business name, logo and colours from `brand.json`.

## Ten questions to ask today

`npm run freight -- insights` answers these from your records:

1. Which carrier overbills us the most, and how much has it credited back?
2. Which surcharges are billed on consignments that never asked for them?
3. How much money is sitting in findings nobody has decided?
4. Which open findings lose their dispute window this fortnight?
5. How much of what we claimed has actually come back?
6. Which consignments were billed heavier than we weighed them?
7. What freight have we shipped that no carrier has billed yet, by cost centre?
8. Which lanes cost the most per kilo?
9. Which rate cards run out before the next review, and how many lanes do they price?
10. Which invoices are due within a week and still not cleared to pay?

## Your first hour: ten things to ask for

1. "Load our Mainfreight rate card from this spreadsheet." (`/rate-cards`)
2. "Here is last month's despatch export, load it." (`/import`)
3. "Audit the invoices that came in this week." (`/audit`)
4. "What did they overcharge us, and by how much?" (`/exceptions`)
5. "Dispute the Road Linehaul invoice and draft the email." (`/dispute`)
6. "We got credit note CN-221 for $84.81 against D-1003." (`/credit`)
7. "What should we accrue for freight at month end?" (`/month-end`)
8. "Get me ready for the rate review with our courier." (`/carrier-review`)
9. "Only raise differences over $5." (`/add` a setting)
10. "Add a pallet count to every consignment." (`/customise`)

## Instead of nShift Audit

Load each carrier's rate card, zones, fuel levies and surcharges, then your consignments and the carrier invoice files, and run the audit. History in nShift's Invoice Explorer comes across from its export with a column map you write once. Step by step, including what does not carry over: [docs/replace-nshift-audit.md](docs/replace-nshift-audit.md). Rules checked by `/compliance`, with sources: [docs/compliance.md](docs/compliance.md).

## Architecture

```
freight-audit-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Freight Audit for Claude Code for your business, migrates your nShift Audit data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=nshift-audit)
- Read more: [enterprisedna.co/omni/instead-of/nshift-audit](https://enterprisedna.co/omni/instead-of/nshift-audit?utm_source=github&utm_medium=readme&utm_campaign=nshift-audit)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
