# Freight Audit for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| Add a carrier, a postcode zone range, an agreed surcharge, a fuel levy or a setting | `/add` |
| Clear an audited invoice for payment once every finding is decided, recording who checked it and what was held back in dispute | `/approve` |
| What needs a person this week | `/attention` |
| Check every new carrier invoice, line by line, against the agreed rate card, the fuel levy for the month, the surcharge schedule and our own consignment records | `/audit` |
| Prepare for a rate review with one carrier | `/carrier-review` |
| Check the invoice records against the rules in docs/compliance | `/compliance` |
| Record a credit note a carrier issued against a dispute and match it | `/credit` |
| Make this system yours in plain language | `/customise` |
| Record a decision on one finding | `/decide` |
| Raise a dispute for every open overcharge on an invoice, then draft the credit request to the carrier | `/dispute` |
| Dispute aging | `/disputes` |
| Draft the credit request letter for one dispute, with every line, the reason and the agreed amount | `/draft-dispute` |
| Save the weekly review as a draft file for the operator to read or forward | `/draft-weekly-review` |
| List every open audit finding with the money at stake and the days left to dispute it | `/exceptions` |
| Export every record to one JSON file the operator owns | `/export` |
| Record a carrier's fuel levy for a month, then re-check open invoices against it | `/fuel-levy` |
| Bring records in from CSV | `/import` |
| Ten questions about freight spend that a carrier portal does not answer, run against your records | `/insights` |
| Show one carrier invoice in full | `/invoice` |
| List carrier invoices with billed versus agreed totals, status and dispute deadline | `/invoices` |
| Freight cost per kilo by carrier and lane, from billed invoices | `/lane-cost` |
| Add a note to an invoice or a dispute | `/log` |
| The month-end freight pack | `/month-end` |
| Add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view` | `/new-view` |
| Rate cards on file, their validity and lane count, and loading a new card when a carrier sends one | `/rate-cards` |
| Carrier scorecard | `/scorecard` |
| Which surcharges each carrier bills, how often, for how much, and how many were challenged | `/surcharges` |
| Freight we have shipped that no carrier has billed yet, with the estimate from the rate card | `/unbilled` |
| The Monday review | `/weekly-review` |

If an ask fits nothing here, run the CLI directly (`npm run freight -- --help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- Never pay a carrier or say an invoice is paid. `approve` records a decision; payment happens in the accounts system.
- A dispute goes to the carrier only from the operator's own email. Draft it with `/draft-dispute`.
- Every write command takes `--actor=NAME`: use the operator's name.
- Money is in integer cents in the database; show it in dollars with the currency.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off nShift Audit.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/nshift-audit
