---
name: portal-refresh
description: Refresh a PortalJS Ask portal's data from its catalogue - re-download, spot schema and category changes, update the notes, re-run the saved answers. Use when asked to refresh, update or re-sync a portal's data.
---

# Refresh a portal's data

Goal: the portal shows current data, its notes still hold, and every saved
answer is re-checked. Work on a branch; nothing goes live without the person's
go-ahead. Read ARCHITECTURE.md first.

## 1. Re-download and compare
- Keep the current profile: `cp portals/<slug>/profile.md /tmp/profile-before.md`.
- `node scripts/portal-data.mjs <slug>` (downloads again, rebuilds the parquet
  files and `profile.md`).
- Compare the two profiles. Look for: columns added, removed or renamed; type
  changes; new or renamed categories (e.g. a 311 request type renamed); new
  "no data" markers; date ranges that didn't move (a source that stopped
  updating); row counts that dropped; a capped download (CKAN dumps stop at
  512,000 rows on some portals).

## 2. Fix the build and the notes
- Schema or category changes: fix `sources.json` transforms first, re-run with
  `--no-download`.
- `notes.md`: update every range, latest month/year, coverage note and trap
  that changed. Verify each number you write with DuckDB.
- Bump `data.snapshot` in `portal.json` to today. This starts a fresh answer
  cache, so no visitor sees an answer from the old data.
- If the portal uses object storage (`data.remote`), upload the new files:
  `BLOB_READ_WRITE_TOKEN=... node scripts/upload-data.mjs <slug>` and set the
  printed URL (it contains the new snapshot) as `data.remote`.

## 3. Re-run the saved answers
Open a draft PR and wait for the preview, then
`ASK_ADMIN_TOKEN=... node scripts/precompute.mjs <slug> --api <preview URL> --force`
(re-plans and re-writes every example on the new data). Drop or replace any
example the new data no longer answers.

## 4. Check and hand over
Run the `portal-verify` skill on the result. Hand over: the preview link, what
changed in the data (one line per table that changed), anything you couldn't
resolve, and the cost of the run (`/api/data/status` before and after).
