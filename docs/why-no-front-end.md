# Why there is no front end

Freight audit is a comparison of three lists: what the carrier agreed to charge, what you sent, and what the carrier billed. Those lists are ordinary records. Most of what an audit subscription adds is the screen on top: an invoice explorer, filters, a dashboard of savings.

That screen used to matter because asking a database a question was hard. It is not hard now. Open this folder in Claude Code, ask "which carrier billed tailgates we never asked for this quarter?", and it runs the query and shows the answer. Ask a question the dashboard never had a chart for and you still get an answer.

## What you gain

- **Questions of your own.** Cost per kilo by lane, surcharges by customer, unbilled freight by cost centre: any join across rates, consignments and invoices.
- **Your records, your database.** Rate cards, findings and disputes stay with you when you change carriers or providers.
- **Rules that match your contracts.** Tolerances, dispute windows and surcharge rules are settings and plain SQL, changed with `/customise`.
- **No per-invoice fee.** The bill does not grow with your freight volume.

## What a screen gives that this does not

- **Reading scanned or PDF invoices on arrival.** This reads CSV and Excel saved as CSV.
- **A shared screen for a large accounts team** to click through exceptions together. Here a person asks Claude Code, or opens the read-only pages from `npm run view`.
- **A phone app.** It runs where Claude Code runs.
- **Carrier connections.** Invoices and consignments arrive as files, not live feeds.

Enterprise DNA builds any of these into your own version when you need them.

Installed and run for you: https://enterprisedna.co/omni/instead-of/nshift-audit
