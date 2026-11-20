---
description: Add a carrier, a postcode zone range, an agreed surcharge, a fuel levy or a setting.
---

Write the record as a small JSON file and run `npm run freight -- add carrier|zone|surcharge|fuel-levy|setting <file> --actor=NAME`.

Shapes:
- carrier: `{"code":"MF","name":"...","country":"NZ","tax_number":"...","payment_terms_days":20,"dispute_window_days":30,"small_business":false}`
- zone: `{"carrier":"MF","postcode_from":600,"postcode_to":2699,"zone":"AKL"}`
- surcharge: `{"rate_card":"MF-2026","code":"TAILGATE","description":"Tailgate truck","amount":"45.00","needs_service":true}`
- fuel-levy: `{"carrier":"MF","month":"2026-11-01","percent":18.5,"source_ref":"..."}`
- setting: `{"key":"tolerance_cents","value":"500","note":"Raise only differences over $5"}`
