---
description: Show one carrier invoice in full: every line with billed and agreed amounts, the findings, decisions and notes.
---

Run `npm run freight -- invoice <invoice number> --json`. Partial numbers work; if several match, show the candidates and ask which.

Present the summary, then the lines with a difference, then the findings with their decision. Say what is left to do before it can be approved.
