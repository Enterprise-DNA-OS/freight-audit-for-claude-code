---
description: Clear an audited invoice for payment once every finding is decided, recording who checked it and what was held back in dispute.
---

Run `/invoice <number>` first. Approval refuses while any finding is open.

Run `npm run freight -- approve <invoice> "<evidence: who checked, against what>" --actor=NAME`.

Report the amount cleared to pay and the amount held in dispute. This is a record in the database only: nothing pays a carrier from here. The operator pays through their accounts system.
