import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { GetStaticPaths, GetStaticProps } from 'next'
import securityCorpus from '../../data/security/corpus.json'
import governanceCorpus from '../../data/governance/corpus.json'
import { CorpusDoc } from '../../lib/types'
import { CORPORA, CorpusId, getCorpus } from '../../lib/corpora'
import { brandPath, resolveBrand } from '../../lib/brands'
import { BrandHeader } from '../../components/BrandHeader'
import { Footer } from '../../components/Footer'

const TIER_STYLE: Record<string, { dot: string; badge: string }> = {
  public: { dot: '#16a34a', badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' },
  internal: { dot: '#d97706', badge: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200' },
  restricted: { dot: '#dc2626', badge: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' },
}

const CORPUS_DATA: Record<CorpusId, CorpusDoc[]> = {
  security: securityCorpus as CorpusDoc[],
  governance: governanceCorpus as CorpusDoc[],
}

export default function DocumentView({ doc, corpusId }: { doc: CorpusDoc; corpusId: CorpusId }) {
  const router = useRouter()
  const question = typeof router.query.q === 'string' ? router.query.q : null
  // Only known client-side once the router hydrates with the real query
  // string; resolveBrand's own fallback (this corpus's neutral default)
  // covers the brief pre-hydration render and any link shared without it.
  const brandParam = typeof router.query.brand === 'string' ? router.query.brand : corpusId
  const brand = resolveBrand(brandParam)
  const corpus = getCorpus(corpusId)
  const tier = TIER_STYLE[doc.tier]

  return (
    <>
      <Head>
        <title>
          {doc.id} — {corpus.label}
        </title>
      </Head>
      <div
        className="min-h-screen flex flex-col"
        style={{
          background: `radial-gradient(900px circle at 15% -5%, ${brand.accentColor}14, transparent 50%), radial-gradient(900px circle at 85% 0%, ${brand.accentColor}0d, transparent 45%), #fafafa`,
        }}
      >
        <BrandHeader brand={brand} />

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-10 py-10 sm:py-14">
          <div className="max-w-3xl mx-auto">
            <Link
              href={brandPath(brand.slug)}
              className="text-sm font-medium hover:underline inline-flex items-center gap-1"
              style={{ color: brand.accentColor }}
            >
              ← Back to search
            </Link>

            <div className="mt-5 flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 break-words">
                {doc.id}
              </h1>
              <span
                className={`text-[10px] font-medium uppercase tracking-wide px-2 py-1 rounded-full ${tier.badge}`}
              >
                {doc.tier}
              </span>
              {doc.meta && <span className="text-xs text-gray-400">{doc.meta}</span>}
            </div>
            <p className="text-sm text-gray-400 mt-1">Published {doc.date}</p>

            {question && (
              <div
                className="mt-6 rounded-2xl p-4"
                style={{ backgroundColor: brand.accentColor + '0d', border: `1px solid ${brand.accentColor}26` }}
              >
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: brand.accentColor }}>
                  Relevant to: “{question}”
                </p>
                <p className="text-sm text-gray-800">{doc.summary}</p>
              </div>
            )}

            <div
              className="mt-6 rounded-2xl border shadow-sm p-6 sm:p-7"
              style={{
                borderColor: brand.accentColor + '26',
                background: `linear-gradient(180deg, ${brand.accentColor}0a, #ffffff 160px)`,
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: tier.dot }}
                />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: brand.accentColor }}>
                  Full document text
                </span>
              </div>
              <p className="text-gray-800 leading-relaxed whitespace-pre-wrap text-[15px]">{doc.description}</p>
            </div>

            <div className="mt-6">
              <a
                href={doc.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full transition-all hover:-translate-y-px hover:shadow-sm"
                style={{ backgroundColor: brand.accentColor + '14', color: brand.accentColor }}
              >
                View original source at {corpus.sourceName}
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </main>

        <Footer brand={brand} />
      </div>
    </>
  )
}

export const getStaticPaths: GetStaticPaths = async () => {
  const paths = (Object.keys(CORPORA) as CorpusId[]).flatMap((corpusId) =>
    CORPUS_DATA[corpusId].map((d) => ({ params: { id: d.id } }))
  )
  return { paths, fallback: false }
}

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const id = params?.id
  for (const corpusId of Object.keys(CORPORA) as CorpusId[]) {
    const doc = CORPUS_DATA[corpusId].find((d) => d.id === id)
    if (doc) return { props: { doc, corpusId } }
  }
  return { notFound: true }
}
