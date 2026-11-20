---
description: Bring records in from CSV: carrier invoices, our consignments, rate cards, or an nShift Audit export.
---

Always run with `--dry-run` first and show the operator what would load.

- Consignments from the shipping or order system: `npm run freight -- import consignments <file.csv> --carrier=CODE --actor=NAME`
- A carrier invoice file (one row per line): `npm run freight -- import invoices <file.csv> --carrier=CODE --actor=NAME`
- An nShift Audit Invoice Explorer export: `npm run freight -- import nshift <file.csv> --carrier=CODE --map=<map.json> --actor=NAME` (start from `examples/nshift-map.example.json` and match the column headings in your export)
- A rate card: see `/rate-cards`

Any layout can be read with `--map=<json>` naming the column for each field. An invoice already loaded is never loaded twice. After importing invoices, run `/audit`. Full guide: `docs/replace-nshift-audit.md`.
