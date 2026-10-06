---
name: portal-verify
description: Check a PortalJS Ask portal's answers against its data before a demo or merge - pre-computed examples and fresh test questions. Use when asked to verify, QA or test a portal.
---

# Verify a portal

Every headline number must be right. Work from `portals/<slug>/instant.json`
and, if asked, a few live questions on a preview.

For each answer:
1. Read the queries (`sql`) and check each measures what its `purpose`
   says: right table, filters (aggregates excluded, one source, full years,
   min_delay > 0 and similar rules in notes.md), sensible units.
2. Re-run the headline numbers yourself with the DuckDB CLI on
   `public/<data.base>/<table>.parquet`, independently of the stored SQL where
   you can (a different, simpler query).
3. Read the story: every number in `lead`, `stat` and `points` must appear in
   the rows or follow from them. Flag explanations of causes, wrong periods
   (partial years), wrong units, and follow-up questions the tables can't answer.
4. Open the portal page (preview or `npm run dev`) on desktop and at phone
   width for at least one answer: charts readable, no overflow.

Report a table: question | verdict (OK / wrong / misleading) | what's wrong |
fix (re-run with `--only "<question>" --force`, a notes.md change, or drop the
example). Fix notes.md problems at the source, then re-run the affected answers.
