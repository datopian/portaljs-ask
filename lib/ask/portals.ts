// A portal is one branded "ask the data" site: its look, its catalogue and the
// handful of datasets it connects. Each lives in portals/<slug>/ (portal.json +
// notes.md + optional instant.json and logo); scripts/build-portals.mjs bundles
// them into portals.generated.json at build time. See ARCHITECTURE.md.

import registry from './portals.generated.json'

export interface PortalDataset {
  id: string // the dataset's name in the catalogue, e.g. "fire-incidents"
  title: string
  url: string
  note: string
  tables: string[] // the DuckDB tables (parquet files) built from it
}

export interface Share {
  q: string
  lead: string
  summary: string
}

export interface Portal {
  slug: string
  name: string
  owner: string // who publishes the data, used in the AI's instructions
  description: string
  headline: string
  intro: string
  placeholder: string
  theme: Record<string, string>
  logo: string | null
  source: { name: string; label: string; url: string; licence?: string }
  catalogue: { type: 'ckan' | 'none'; api?: string; datasetUrl?: string }
  data: { base: string; snapshot: string; remote?: string } // base: local build path under public/; remote: where browsers load the files from, if uploaded (scripts/upload-data.mjs)
  live: boolean // false = examples-only: no question box, no AI calls
  examples: string[]
  datasets: PortalDataset[]
  notes: string // what the AI knows about the tables (portals/<slug>/notes.md)
  shares: Record<string, Share> // saved answers' headlines by normalised question, for link previews
}

const PORTALS = (registry as unknown as { portals: Record<string, Portal> }).portals

export function getPortal(slug: unknown): Portal | null {
  return typeof slug === 'string' && Object.prototype.hasOwnProperty.call(PORTALS, slug) ? PORTALS[slug] : null
}

export function portalTables(p: Portal): string[] {
  return p.datasets.flatMap((d) => d.tables)
}
