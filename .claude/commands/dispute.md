---
description: Raise a dispute for every open overcharge on an invoice, then draft the credit request to the carrier.
---

1. Run `/invoice <number>` and confirm with the operator which findings are real. Accept or waive the ones that are not first (`/decide`).
2. Run `npm run freight -- dispute <invoice> --actor=NAME` (add `--ref=` for the carrier case number). If the dispute window has closed the command refuses; only add `--late` when the operator says so, and log why.
3. Run `npm run freight -- draft-dispute <D-code>` and show the draft. It is saved under `drafts/`. Never send it: the operator sends it from their own email.
4. Remind the operator that the rest of the invoice can now be approved with `/approve`.
