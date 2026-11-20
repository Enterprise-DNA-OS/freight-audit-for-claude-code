---
description: Rate cards on file, their validity and lane count, and loading a new card when a carrier sends one.
---

Run `npm run freight -- rate-cards --json` and flag anything expiring within 30 days.

To load a new card: save the schedule as CSV with origin_zone, dest_zone, basic, per_kg, min (dollars), then run
`npm run freight -- import rates <file.csv> --carrier=CODE --card=NEW-CODE --service="<service>" --from=YYYY-MM-DD --to=YYYY-MM-DD --cubic=250 --dry-run`, check the lanes, and run it again without `--dry-run` and with `--actor=NAME`. Add agreed surcharges with `/add`. A new card never overwrites an old one: invoices are checked against the card valid on the ship date.
