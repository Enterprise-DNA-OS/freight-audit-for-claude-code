# Compliance checks

`/compliance` (or `npm run freight -- compliance`) checks the invoice records against the rules below. Each check lives in the `compliance_findings` view in `supabase/migrations/0001_freight_audit.sql`. They support a person's review. They are not tax or legal advice, and they do not certify anything. Confirm each rule with your accountant before relying on it, and change a rule with `/customise`.

| Rule | Source | What a breach looks like | Check |
|---|---|---|---|
| TAX_INVOICE_DETAILS | NZ: Goods and Services Tax Act 1985, sections 19F to 19N (taxable supply information, from 1 April 2023). AU: A New Tax System (Goods and Services Tax) Act 1999, section 29-70, and the ATO's tax invoice guidance. | An invoice with no GST number (NZ) or ABN (AU) recorded. Without it you may not be able to claim the GST back. | `supplier_tax_number` is blank. The audit also raises a TAX_INVOICE finding so the invoice cannot be approved until someone decides it. |
| GST_AMOUNT | NZ: GST Act 1985, section 8 (15%). AU: GST Act 1999, section 9-70 (10%). | GST billed differs from the rate applied to the invoice total by more than two cents. | Compares `gst_cents` with the total at the carrier country's rate. Zero-rated or GST-free freight (international legs) needs its own rule: add it with `/customise`. |
| PAYMENT_TIMES_SMALL_BUSINESS | Payment Times Reporting Act 2020 (Cth). Applies to businesses that are reporting entities under the Act; they report how fast they pay small business suppliers. | An invoice from a carrier flagged `small_business` is past its due date and still not cleared. | `carriers.small_business` and `invoices.due_date`. Only meaningful if your business reports under the Act; otherwise treat it as good practice. |
| DISPUTE_WINDOW | Your carrier contract or terms of trade, not law. Set `dispute_window_days` per carrier from the signed terms. | An overcharge is still undecided after the window to dispute it has closed. | Open findings with a positive difference where `invoice_date + dispute_window_days` has passed. `dispute` refuses after the window unless `--late` is given. |
| APPROVAL_EVIDENCE | Your own payment controls. | An invoice approved with no record of who checked it and against what. | `approve` requires an evidence reference; this flags any approved invoice without one (for example after a hand edit). |

## Record keeping

NZ businesses keep tax records for seven years (Tax Administration Act 1994, section 22). AU businesses generally keep them for five years (Income Tax Assessment Act 1936, section 262A). No command in this repo deletes an invoice, line, finding, dispute or credit note, and `npm run freight -- export` writes the whole record to one file you can archive.
