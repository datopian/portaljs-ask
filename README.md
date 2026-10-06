# PortalJS Ask (search.portaljs.com)

Ask a question about a data catalogue in plain English and get a short data
story with charts. One engine, one folder per branded portal: see
[ARCHITECTURE.md](ARCHITECTURE.md).

Also hosts the document-search sales demos at `/security`, `/governance` and
`/demo/<brand>` (build spec in the `sales` repo,
`docs/poc-demos/security-knowledge-search-demo-spec.md`).

## Local development

```
npm install
cp .env.example .env.local   # fill in the keys you need
npm run dev                  # builds the portals, then starts Next.js
```

Portals: edit `portals/<slug>/`, then `npm run portals` (dev and build run it for you).
