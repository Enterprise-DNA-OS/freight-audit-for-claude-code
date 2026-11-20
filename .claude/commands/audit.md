---
description: Check every new carrier invoice, line by line, against the agreed rate card, the fuel levy for the month, the surcharge schedule and our own consignment records.
---

The Monday job.

1. If the operator has new invoice files, run `/import` first.
2. Run `npm run freight -- audit --actor=NAME --json`. Add an invoice number to audit one invoice; add `--again` to re-check invoices already audited after a rate card or fuel levy change.
3. For each invoice report: lines checked, findings, status. `on_hold` means something needs a decision; `received` means it is clean and ready for `/approve`.
4. Then run `/exceptions` so the operator sees the money.

The checks: DUPLICATE (billed before), NO_CONSIGNMENT (not one of ours), ZONE (billed to the wrong zone), WEIGHT (heavier than our chargeable weight beyond the weight tolerance), RATE, FUEL, SURCHARGE_NOT_AGREED, SURCHARGE_NOT_REQUESTED, SURCHARGE_RATE, OTHER_CHARGE, NO_RATE, FUEL_LEVY_UNKNOWN, TOTAL, GST, TAX_INVOICE. Differences at or under `tolerance_cents` (default $2.00) are not raised.
