import brandConfigData from '../brand-config.json'
import { CorpusId, isCorpusId } from './corpora'

export interface BrandConfig {
  displayName: string
  corpusId: CorpusId
  accentColor: string
  tagline?: string
  logoUrl?: string | null
  /** The slug (/<corpus> or /demo/<brand>) this resolved from — carried through to other
   * pages (e.g. the document view) via a query param, purely so a visitor's
   * skin stays consistent when they navigate away from the ask page. */
  slug: string
}

interface BrandConfigEntry {
  displayName: string
  corpusId: CorpusId
  accentColor: string
  tagline?: string
  logoUrl?: string | null
}

const BRANDS = brandConfigData as Record<string, BrandConfigEntry>

const NEUTRAL_TAGLINE = 'Ask a plain-language question, get a cited answer.'
const NEUTRAL_ACCENT = '#4f46e5'

export function getDefaultBrand(corpusId: CorpusId): BrandConfig {
  return {
    displayName: '',
    corpusId,
    accentColor: NEUTRAL_ACCENT,
    tagline: NEUTRAL_TAGLINE,
    logoUrl: null,
    slug: corpusId,
  }
}

// Resolves a /demo/<slug> path to a brand + corpus:
// - slug is a corpus id ("security"/"governance") -> that corpus's neutral default
// - slug matches a brand-config entry -> that entry's skin + its corpusId
// - anything else (unrecognized, missing) -> the security corpus's neutral
//   default, per spec: an unrecognized brand can't guess which corpus was
//   intended, so it falls back to the security corpus.
export function resolveBrand(slug: string | undefined | null): BrandConfig {
  if (!slug) return getDefaultBrand('security')
  const lower = slug.toLowerCase()
  if (isCorpusId(lower)) return getDefaultBrand(lower)
  const entry = BRANDS[lower]
  if (entry) return { ...getDefaultBrand(entry.corpusId), ...entry, slug: lower }
  return getDefaultBrand('security')
}

// Where a brand's ask page lives: the neutral corpus demos sit at /<corpus>,
// client-branded skins stay at /demo/<slug>.
export function brandPath(slug: string): string {
  return isCorpusId(slug) ? `/${slug}` : `/demo/${slug}`
}

export function listBrandSlugs(): string[] {
  return Object.keys(BRANDS)
}
