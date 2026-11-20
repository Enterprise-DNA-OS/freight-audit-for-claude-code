---
description: Record a credit note a carrier issued against a dispute and match it.
---

Ask for the dispute code, credit note number, amount and date if missing.

Run `npm run freight -- credit <D-code> <credit-no> <amount> <YYYY-MM-DD> --actor=NAME`.

Report claimed, credited so far and the status (credited or part_credited). If it is short, say by how much and offer `/disputes` to chase the rest. If the carrier refused, use `npm run freight -- close-dispute <D-code> rejected "<reason>" --actor=NAME`.
