# PortalJS Ask (search.portaljs.com)

Ask a question about an organisation's open data in plain English and get a short data story
with charts. Every number comes from a SQL query run on the real data, and every chart shows
its query.

One engine, one config folder per client. Live:
[search.portaljs.com](https://search.portaljs.com) (DataHub, the default) ·
[search.portaljs.com/demo/toronto](https://search.portaljs.com/demo/toronto)

How it works in depth (pipeline, costs, hosting, decisions): [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Which solution should I use?

Datopian has two ways to build a client demo. They are different products, in different repos.

| | **PortalJS Ask** (this repo) | **Portal demo** |
|---|---|---|
| What the client sees | One page with a question box. A question gets a short data story with charts | Their own portal, modernised: catalogue, search, dataset pages, plus an optional data story and "Ask AI" |
| What it sells | The AI question-answering layer on its own | A portal revamp or migration (with AI as a bonus) |
| Best for | Organisations with open data but no portal they care about, or an AI add-on for an existing client | Anyone who already runs a portal: CKAN, ArcGIS Hub, EntryScape, Opendatasoft, Socrata |
| Effort | Hours: pick 5–20 datasets, write data notes and example questions | Days: connect the backend, brand it, write one story |
| Repo | `datopian/portaljs-ask`, one folder per client in `portals/` | `datopian/data-portal-examples` (internal), see its `CLIENT-DEMO-GUIDE.md` |
| URL | `search.portaljs.com/demo/<slug>` or the client's own domain | `<slug>.arc.portaljs.com` or `<slug>.portaljs.com` |

They combine well: a portal demo's story page can link to the client's PortalJS Ask page
for follow-up questions.

---

## 2. What it is, and what it is not

**It is:**
- A Next.js app on Vercel. A visitor's question goes to Claude, which writes SQL. The SQL runs
  **in the visitor's browser** (DuckDB) over the client's data as parquet files, and Claude then
  writes the story from the result rows.
- **Fact-checked automatically**: a second AI call compares each claim in a new story with the
  rows and fixes wrong ones before the story is shown or cached.
- **Cheap to show**: example questions are pre-computed (free and instant), and repeated
  questions are cached for 30 days. Only new typed questions cost money, about 5–8 US cents each.
- **Configuration, not code, per client**: a folder in `portals/<slug>/`. Never a fork.

**It is not:**
- **Not a document search or chatbot.** It answers from tables only. The document demos
  (`/security`, `/governance`) were removed on 2026-10-12.
- **Not a data portal.** There's no catalogue, dataset pages or publishing. For that, build a
  portal demo (§1).
- **Not for private or big data.** Data files are public, and it works up to tens of MB per table.
  Non-public or multi-GB data needs a server-side setup, which is a separate offer.
- **Not a live feed.** Each portal is a snapshot we download, clean and describe. Refreshing it
  is a deliberate step (`portal-refresh`).
- **Not logins or permissions.** Everyone sees the same data.

---

## 3. Where everything lives

| What | Where |
|---|---|
| Code | This repo. `main` is production |
| Hosting | Vercel, Datopian team, project `portaljs-ask`. Every pull request gets a preview URL |
| Client configs | `portals/<slug>/`: `portal.json`, `sources.json`, `notes.md`, `profile.md`, `instant.json` |
| Which portal is the homepage, client domains | `portals/index.json` |
| Data files | Vercel Blob store `portaljs-ask-data`, one folder per portal and snapshot. Not in git |
| Team skills for Claude Code | `.claude/skills/`: `portal-new`, `portal-verify`, `portal-refresh`, `ask-cost-report` |

Existing portals: `datahub` (17 DataHub core datasets, the homepage) and `toronto` (20 City of
Toronto datasets).

---

## 4. Run it locally

You need Node 20+ and an Anthropic API key (ask for the team key; never commit it).

```bash
gh repo clone datopian/portaljs-ask
cd portaljs-ask
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY at minimum
npm run dev                  # builds the portal configs, then starts Next.js
```

- http://localhost:3000 shows the default portal; http://localhost:3000/demo/toronto shows Toronto.
- Example questions load from `instant.json` and cost nothing. Typed questions call the API and cost money.
- Without the Upstash Redis variables, limits and the answer cache are per process. That's fine locally.
- After editing anything in `portals/`, re-run `npm run portals` (dev and build do it for you).

---

## 5. Add a client portal

**Easiest:** in Claude Code, from this repo, run the `portal-new` skill and give it the
organisation, its catalogue URL and (optionally) the datasets. It follows the steps below and
stops at a preview link.

**By hand** (full detail in ARCHITECTURE.md §6 and `.claude/skills/portal-new/SKILL.md`):

1. **Branch:** `git checkout -b portal/<slug>`
2. **Config:** create `portals/<slug>/portal.json` by copying `portals/toronto/portal.json`
   and changing every field (name, owner, headline, theme colours, logo, source, catalogue,
   `data.base` = `/data/<slug>/`, `data.snapshot` = today). Add `sources.json` with 5–20 tables.
   Pick tabular datasets with dates and categories people ask about; skip map-only, PDF-only
   or very large datasets.
3. **Data:** `node scripts/portal-data.mjs <slug>` downloads, cleans and converts the data and
   writes `profile.md`. Resolve every **Check** item it lists.
4. **Notes:** write `portals/<slug>/notes.md`: for every table, what one row is, every column
   with unit and range, how to count correctly, and traps. **This is where answer quality comes
   from.** Check every number you write with DuckDB.
5. **Questions:** add `datasets` and 15–20 `examples` to `portal.json`. The first 3 are the
   headline ones.
6. **Upload data:** `BLOB_READ_WRITE_TOKEN=... node scripts/upload-data.mjs <slug>`, then put the
   printed URL in `data.remote` in `portal.json`. Deploys fail without it.
7. **Preview:** `npm run portals && npx tsc --noEmit -p .`, commit, push, open a draft PR and
   wait for the Vercel preview.
8. **Pre-compute and verify:**
   `ASK_ADMIN_TOKEN=... node scripts/precompute.mjs <slug> --api <preview URL>`, then run the
   `portal-verify` skill. **Read every saved story against its rows** (counts, ratios,
   "highest", periods), not only the headline numbers.
9. **Merge** once the portal owner agrees. It's live at `search.portaljs.com/demo/<slug>`.

**Zero-risk mode:** set `"live": false` in `portal.json`. The question box disappears, only
the pre-computed examples show, and the AI cost is zero. Use it for demos sent by email.

**Client's own domain** (e.g. `ask.example.org`): add `"<host>": "<slug>"` to `domains` in
`portals/index.json`, add the domain to the Vercel project, and have the client point a CNAME
at `cname.vercel-dns.com`. See ARCHITECTURE.md §6.

---

## 6. Costs and limits

| Limit | Default | Env var |
|---|---|---|
| Monthly AI spend for live questions | $40 (Anthropic account hard cap: $50) | `ASK_MONTHLY_BUDGET_USD` |
| Live questions per day, all portals | 30 | `ASK_DAILY_TOTAL` |
| Live questions per visitor per day | 5 | `ASK_DAILY_PER_VISITOR` |

When a limit is hit, live questions pause and the examples keep working. Check spend with the
`ask-cost-report` skill, or:
`curl -H "x-ask-admin: $ASK_ADMIN_TOKEN" https://search.portaljs.com/api/data/status`

---

## 7. Before showing a portal to a client

- [ ] Run every example question on production; each answer loads and reads correctly.
- [ ] Check one headline number per portal against an official published figure.
- [ ] Open it on a phone.
- [ ] Open one shared answer link (`?q=...`) and check the link preview.
- [ ] Decide `"live": true` or `false` for this audience.
- [ ] After a data refresh: bump `data.snapshot` (this starts a fresh cache), re-check the
      notes, re-run pre-compute.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| "Live questions are paused" | A daily or monthly limit was hit. Examples still work. See §6 |
| Deployment fails | A portal is missing `data.remote` in `portal.json` (step 6), or `npx tsc --noEmit -p .` fails |
| Wrong or odd numbers in answers | Fix `notes.md` (units, how to count, traps), then re-run `precompute.mjs` (`--restory` rewrites stories from existing rows) |
| Question outside the data | Expected: the page offers a free catalogue search linking to matching datasets |
