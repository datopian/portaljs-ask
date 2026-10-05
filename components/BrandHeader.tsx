import { ReactNode } from 'react'
import Link from 'next/link'
import { BrandConfig } from '../lib/brands'
import { getCorpus } from '../lib/corpora'

export function BrandHeader({
  brand,
  right,
  subtitle,
}: {
  brand: BrandConfig
  right?: ReactNode
  subtitle?: ReactNode
}) {
  const corpus = getCorpus(brand.corpusId)
  const heading = brand.displayName ? `${brand.displayName} — ${corpus.label}` : corpus.label

  return (
    <header className="sticky top-0 z-20 backdrop-blur bg-white/85 border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-10 py-3 sm:py-4">
        <div className="flex items-center gap-3">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={`${brand.displayName} logo`} className="h-8 w-auto shrink-0" />
          ) : (
            <div
              className="h-9 w-9 shrink-0 rounded-xl grid place-items-center text-white font-semibold text-sm"
              style={{ backgroundColor: brand.accentColor }}
            >
              {(brand.displayName || 'T').charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <Link href={`/${brand.corpusId}`} className="flex items-center gap-2 group">
              <h1
                className="text-base sm:text-lg font-semibold tracking-tight truncate group-hover:opacity-80 transition-opacity"
                style={{ color: brand.accentColor }}
              >
                {heading}
              </h1>
              <span className="hidden lg:inline-block text-[10px] font-medium uppercase tracking-wider text-gray-400 border border-gray-200 rounded-full px-2 py-0.5 shrink-0">
                Demo
              </span>
            </Link>
          </div>
          {right}
        </div>
        {/* Its own full-width row (not squeezed into the title column) so
            the role-reactive document count stays visible at every width,
            including phones — this is the acceptance-criteria line. */}
        {subtitle && <div className="mt-2 sm:mt-1.5">{subtitle}</div>}
      </div>
      <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, ${brand.accentColor}, transparent)` }} />
    </header>
  )
}
