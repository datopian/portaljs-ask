---
name: portal-new
description: Create a new branded "ask the data" portal for a client or prospect from their open data catalogue (CKAN or data packages such as DataHub). Use when asked to set up, onboard or demo PortalJS Ask for an organisation.
---

# New portal

Goal: a branded portal at `/demo/<slug>` on a preview link, with correct data
notes and pre-computed example answers. Read ARCHITECTURE.md first.

## 1. Gather (ask only for what you can't find)
- Organisation name and slug (lower-case, dashes).
- Catalogue: CKAN API base (`https://<host>/api/3/action`) or data package URLs.
- 5 to 20 datasets. If the person doesn't choose, pick the most useful ones:
  tabular, updated, with dates and categories people ask about. Avoid
  datasets that are only maps, PDFs, or over ~50 MB as parquet.
- Branding: accent colour, dark colour, highlight colour, logo (SVG or PNG),
  from their website if not given. Never copy a logo you can't confirm is theirs.

## 2. Configure
Create `portals/<slug>/`:
- `portal.json`: copy `portals/toronto/portal.json` and change everything
  (name, owner, description, headline, intro, placeholder, theme, logo,
  source, catalogue, `data.base` = `/data/<slug>/`, `data.snapshot` = today).
  Leave `datasets` and `examples` for step 4.
- `sources.json`: one entry per table (see the header of
  `scripts/portal-data.mjs`). Start without `sql`; add transforms after the
  first run.

## 3. Build the data
`node scripts/portal-data.mjs <slug>` (re-run with `--no-download` while
editing transforms). Then read `portals/<slug>/profile.md` and resolve every
**Check** item in `sources.json` (nullif placeholders, fix encodings, map
renamed categories, flag region totals, de-duplicate) or in the notes.
Look at sample rows yourself too: the profile catches common traps, not all.

## 4. Write notes.md and examples
- `notes.md` is what the AI knows. For every table: what one row is, every
  column with type, unit and range, how to count correctly, and traps (see
  `portals/datahub/notes.md` and `portals/toronto/notes.md` for the level of
  detail). Verify every number you write with DuckDB.
- `portal.json` `datasets`: id (catalogue name), title, url, one-line note,
  tables. `examples`: 15 to 20 short questions; the first 3 are the headline
  ones. Each must be answerable from the tables.

## 5. Preview and pre-compute
`npm run portals && npx tsc --noEmit -p .`, commit on a branch, push, open a
draft PR, wait for the Vercel preview. Then
`ASK_ADMIN_TOKEN=... node scripts/precompute.mjs <slug> --api <preview URL>`.
Run the `portal-verify` skill on the result before handing over.

## 6. Hand over
Preview link to `/demo/<slug>`, the three headline answers in one line each,
anything you couldn't resolve, and the cost of pre-computing (from the
`ask_ai_usage` logs). Never merge to main without the person's go-ahead.
