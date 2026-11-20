---
description: List every open audit finding with the money at stake and the days left to dispute it.
---

Run `npm run freight -- exceptions --json`.

Group by invoice. For each finding show connote, check, billed, agreed, difference, days left. Total the overcharge per carrier.

Recommend a decision for each: dispute (positive difference and the window is open), accept (the carrier is right, for example a reweigh the operator confirms), or waive (not worth chasing). The operator decides; record it with `/decide` or `/dispute`.
