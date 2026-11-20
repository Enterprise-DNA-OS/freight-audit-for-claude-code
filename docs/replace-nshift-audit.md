# Moving off nShift Audit

nShift Audit reads your carrier invoices, matches each line to the shipment and the contracted rate, and raises disputes. This repo does the same job from three things you already have: the carriers' invoice files, your consignment records, and your rate cards. Plan a day for the first carrier and an hour for each one after.

## 1. Collect what you need

- **Rate cards.** The signed rate schedule from each carrier: lanes by zone, basic charge, rate per kilo, minimum, cubic conversion, agreed surcharges. nShift holds these in its Freight Rate Calculation service; if you cannot export them, the carrier's schedule is the source.
- **Postcode zones.** Each carrier's zone list (postcode ranges to zone names).
- **Fuel levies.** The carrier's published levy for each month you will audit.
- **Consignments.** A CSV from your shipping or order system: connote, ship date, origin and destination postcodes, weight, cubic, services requested (tailgate, residential, booked delivery), cost centre.
- **Invoices.** Carriers send invoice files as CSV or Excel (save Excel as CSV). For history already in nShift, its Invoice Explorer has an export; save it as CSV.

## 2. Load the carrier

Add the carrier, its zones and surcharges with `/add`, the fuel levies with `/fuel-levy`, and the rate card:

```bash
npm run freight -- import rates schedule.csv --carrier=MF --card=MF-2026 --service="Road general freight" --from=2026-01-01 --to=2026-12-31 --cubic=250 --dry-run
```

Columns: `origin_zone,dest_zone,basic,per_kg,min` in dollars. See `examples/rates.csv`.

## 3. Load consignments and invoices

```bash
npm run freight -- import consignments shipments.csv --carrier=MF --dry-run
npm run freight -- import invoices invoice.csv --carrier=MF --dry-run
```

See `examples/consignments.csv` and `examples/carrier-invoice.csv` for the columns. Common alternative headings are recognised (for example "consignment number", "weight", "amount ex gst"). For any other layout, pass `--map=map.json` naming the column for each field. Drop `--dry-run` and add `--actor=NAME` to load. An invoice already loaded is skipped, never loaded twice.

## 4. Bring nShift history across

```bash
cp examples/nshift-map.example.json nshift-map.json   # edit the right-hand names to match your export's headings
npm run freight -- import nshift explorer-export.csv --carrier=MF --map=nshift-map.json --dry-run
```

We did not have a real Invoice Explorer export when this was built, so the map file is an example to edit, not a known layout. Check the dry run line counts against nShift before loading. Past dispute outcomes and credit notes do not come across automatically: record open disputes with `dispute` and credits with `credit`, and keep the nShift export file for the closed ones.

## 5. Audit and compare

```bash
npm run freight -- audit --actor=NAME
npm run freight -- exceptions
```

Run one month in both systems and compare the findings. Differences usually come from a missing zone, surcharge or fuel levy row; `unbilled` and the `NO_RATE` finding name what is missing.

## What does not carry over

- **Reading PDF or scanned invoices.** This repo reads CSV. Most carriers send CSV or Excel on request; otherwise ask Claude Code to turn a PDF into the invoice CSV and check it before importing.
- **Shipment data from nShift's own booking products.** Here consignments come from your own system's export.
- **Sending disputes from the platform.** Disputes are drafted to `drafts/` and you send them from your own email.
- **Paying carriers.** Approval is a record. You pay through your accounts system.
