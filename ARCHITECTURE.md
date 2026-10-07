# Architecture: PortalJS Ask

One product, many branded portals. A visitor types a question in plain English
and gets a short data story with charts, built from a client's own open data,
with every number traceable to a query.

This repo also hosts the older document-search demos (`/security`,
`/governance`, `/demo/<brand>`). They are a separate product that happens to
share the deployment; nothing below applies to them unless it says so.

## 1. Principles

1. **One engine, configuration per client.** A new client is a folder in
   `portals/`, never a fork and never client-specific code. If a client needs
   something new, it becomes an engine option that every portal can use.
2. **The AI never invents numbers.** It writes SQL and it writes prose about
   result rows. The SQL runs on the real data, and every chart shows its query.
3. **Spend has hard limits in code**, not just good intentions (section 4).
4. **Data is a snapshot we control.** We download, clean and describe a
   client's datasets ourselves. The data notes are where the quality comes from.
5. **Everything goes through a preview link first.** `main` is production.

## 2. How it works

```
Visitor's browser                         Server (Vercel functions)          Anthropic
-----------------                         -------------------------          ---------
types a question  ─────────────────────▶  /api/data/plan
                                            cache hit? → free
                                            else limits check, then ───────▶  writes SQL
                  ◀── SQL + token ─────────
runs SQL on the portal's parquet files
with DuckDB in the browser (no data server)
                  ── result rows ────────▶ /api/data/write
                                            cache hit? → free
                                            else ──────────────────────────▶  writes the story
                  ◀── story ───────────────
draws charts, shows the story and the queries
```

- **Example questions are pre-computed** (`portals/<slug>/instant.json`). They
  show instantly and cost nothing. Most demo visitors only click examples.
- **Typed questions** cost about 3 to 8 US cents each (two Sonnet calls, plus a
  third when a query needs repairing). Measured on 6 Oct 2026: about 3 cents when
  the AI's copy of the data notes is still cached (5 minutes after the last
  question), about 8 cents cold. At demo traffic most questions are cold, so
  plan on 5 to 8 cents. Every call's token usage is priced and logged as an
  `ask_ai_usage` event.
- **Repeated questions are cached** for 30 days per portal and data snapshot:
  the plan by question, and the story by question plus exact result rows (so a
  tampered browser can't change what other visitors see).
- **Questions outside the connected datasets** get a free catalogue search
  (CKAN API, no AI) linking to matching datasets on the client's portal.

## 3. Repo layout

```
portals/
  index.json              which portal is the homepage ("default")
  <slug>/
    portal.json           branding, catalogue, datasets, example questions, live on/off
    notes.md              what the AI knows about each table: columns, ranges, traps
    sources.json          where each table comes from and how it's cleaned (scripts/portal-data.mjs)
    profile.md            generated data profile with the traps to check
    instant.json          pre-computed answers to the examples (scripts/precompute.mjs)
    logo.svg              optional
engine/ask.html           the page template every portal uses
lib/ask/
  engine.ts               prompts, AI calls, cache keys, tokens, catalogue search
  guard.ts                limits, spend tracking, answer cache (Redis or memory)
  portals.ts              portal types and lookup
pages/api/data/           plan, write, status endpoints
scripts/
  build-portals.mjs       runs before dev/build: portals/ -> public/p/<slug>/ + lib/ask/portals.generated.json
  portal-data.mjs         downloads a portal's datasets (CKAN or data packages), builds parquet, writes profile.md
  precompute.mjs          fills instant.json through the real pipeline
.claude/skills/           portal-new, portal-verify (Claude Code skills for the team)
public/data/<slug>/       parquet files (moving to object storage, section 5)
```

Routes: `/` is the default portal, `/demo/<slug>` is every portal.

## 4. Cost and limits

The Anthropic account has a **hard $50/month cap** (set in the Anthropic
console). The app stops itself well before that:

| Limit | Default | Env var | Why |
|---|---|---|---|
| Monthly AI spend for live questions | $40 | `ASK_MONTHLY_BUDGET_USD` | Leaves $10 under the hard cap for the document demos and pre-computing |
| Live questions per day, all portals | 30 | `ASK_DAILY_TOTAL` | At up to 8 cents each, a fully used day is about $2.40, so one bad day can't eat the month |
| Live questions per visitor per day | 5 | `ASK_DAILY_PER_VISITOR` | Enough to be impressed, not enough to farm |

When a limit is hit, the page says live questions are paused and the examples
keep working. Cached answers never count. `"live": false` in `portal.json`
turns a portal into examples-only (no question box, zero AI cost), for demos
where there should be no risk at all.

The limits only hold across server instances with the shared store (Upstash
Redis, section 5). Without it each instance counts separately; the hard cap in
the Anthropic console is then the only real backstop.

Check spend: `curl -H "x-ask-admin: $ASK_ADMIN_TOKEN" https://search.portaljs.com/api/data/status`.

Expected spend: a few dollars a month at demo traffic, because examples and
repeats are free.

## 5. Hosting

| Piece | Now | Target | When |
|---|---|---|---|
| App | Vercel, personal team | Vercel, Datopian's paid team | Now: the free plan doesn't allow commercial use |
| Limits and answer cache | In memory per instance | Upstash Redis via the Vercel Marketplace (free tier) | Now |
| Data files | `public/data/<slug>/` in git (31 MB for Toronto) | Object storage: Vercel Blob, or Cloudflare R2 if downloads grow (R2 has no transfer fees). Set `data.base` in `portal.json` to the bucket URL | Before the third portal |
| AI | Anthropic API, shared key | A dedicated key and workspace for this product, with its own spend cap | Now |

Why browser-side queries: no database to run or pay for, it scales with
visitors, and a client's data never touches our servers at query time. The
limit is size: it works well up to tens of MB per table. A client whose key
data is multi-GB needs a server-side query engine. That's a different setup,
priced separately.

Data files are public by design (open data). A client with non-public data
needs authenticated storage and probably the server-side engine. That's also a
separate offer.

## 6. Adding a portal

Run the `portal-new` skill in Claude Code, or by hand:

1. `portals/<slug>/portal.json` (branding, catalogue) and `sources.json` (5 to
   20 datasets from the client's CKAN or data packages).
2. `node scripts/portal-data.mjs <slug>`: downloads, cleans and converts the
   data, and writes `profile.md`. It handles capped CKAN dumps (Toronto's stop
   at 512,000 rows) and flags renamed categories, placeholder text, garbled
   characters, "no data" markers, zeros and partial years.
3. Resolve the profile's **Check** items in `sources.json`, then write
   `notes.md`: every table and column, units, ranges, how to count, traps.
4. Add `datasets` and 15 to 20 `examples` to `portal.json`.
5. Open a PR, run `scripts/precompute.mjs` on the preview, then the
   `portal-verify` skill.
6. Merge. The portal is live at `/demo/<slug>`.

The DataHub portal (17 datasets) took about an hour this way, most of it on the
notes. The profile caught a duplicated series, euro countries ending in 2001,
zeros meaning "no value", and two malformed source files.

## 7. Operating it

- **Weekly**: spend and refusals (`/api/data/status`, `ask_*` events in Vercel logs).
- **Per data refresh**: rebuild the parquet files, bump `data.snapshot` (this
  starts a fresh answer cache), check the notes still hold, re-run precompute.
- **Before a client demo**: run the examples on production, and check the
  portal works on a phone.

## 8. Recommended setup around the code

**Repos.** One product repo. Rename this one to `datopian/portaljs-ask` once the
document demos move out (or keep them here as a separate module until either
product grows). Portal configs stay in the same repo: at tens of clients this
is simpler than a config service, and every change gets a reviewed preview.
Data lives in object storage, not git. Never fork per client. A client who buys
gets either a portal on our deployment (their domain pointed at it), or the
same repo deployed in their cloud with their portal folder and bucket.

**Claude Code skills** (in `.claude/skills/` of this repo, so anyone on the team
can run them):

| Skill | What it does |
|---|---|
| `portal-new` | Onboards a client: catalogue URL, datasets, branding in; parquet, `notes.md`, `portal.json`, pre-computed examples and a preview PR out |
| `portal-verify` | Asks test questions on a preview and checks each headline number against the data with DuckDB; reports anything that doesn't match |
| `portal-refresh` | Re-downloads a portal's data, flags schema changes and renamed categories, updates the notes, re-runs pre-compute |
| `ask-cost-report` | Spend, question counts, cache hit rate and refusals for the month, with a recommendation on limits |

## 9. Decisions

| Date | Decision |
|---|---|
| 2026-10-06 | Config-per-portal engine; Toronto is the first portal. Hand-built Toronto stories replaced by pre-computed live answers |
| 2026-10-06 | Spend: $50 hard cap at Anthropic, $40 app budget, 30 live questions a day, 5 per visitor; examples and repeats free |
| 2026-10-06 | Sonnet for live questions (Haiku made too many factual slips in testing) |
| 2026-10-07 | DataHub ("Ask the world's data") is the homepage; Toronto moves to /demo/toronto |
