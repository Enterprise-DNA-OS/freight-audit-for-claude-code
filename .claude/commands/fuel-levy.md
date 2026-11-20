---
description: Record a carrier's fuel levy for a month, then re-check open invoices against it.
---

Carriers publish a fuel levy each month. Ask for carrier, month and percentage, and where it was published.

Write a JSON file such as `{"carrier":"RL","month":"2026-11-01","percent":18.5,"source_ref":"carrier fuel page"}` and run `npm run freight -- add fuel-levy <file> --actor=NAME`. Then `npm run freight -- audit --again --actor=NAME` to re-check open invoices.
