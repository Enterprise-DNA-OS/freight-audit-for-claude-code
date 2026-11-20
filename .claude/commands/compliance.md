---
description: Check the invoice records against the rules in docs/compliance.md (tax invoice details, GST, small business payment times, dispute windows, approval evidence) and report what needs fixing, rule cited.
---

1. Read `docs/compliance.md`. Each rule has its source, what a breach looks like and the check that finds it.
2. Run `npm run freight -- compliance --json`.
3. Report as a table: rule, record, carrier, finding, source. Breaches that cost money (GST, dispute window) first.
4. For each, draft the fix for the operator: ask the carrier for a corrected tax invoice (draft to `drafts/`, never send), decide the finding, or record the approval evidence.
5. If a rule looks out of date, say so and stop. Do not guess at law. The operator confirms the rule, then you update the doc and the check together.

Nothing here is tax or legal advice. These checks support a person's review.
