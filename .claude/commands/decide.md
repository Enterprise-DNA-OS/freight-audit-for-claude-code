---
description: Record a decision on one finding: accepted (the carrier is right) or waived (not worth disputing), with the reason.
---

Ask for the finding id (first 8 characters from `/exceptions`), the decision and the reason if the operator did not give them.

Run `npm run freight -- decide <finding> accepted|waived "<reason>" --actor=NAME`.

To dispute, use `/dispute` instead: it takes every open overcharge on the invoice at once.
