import Head from 'next/head'
import { GetStaticPaths, GetStaticProps } from 'next'
import { AskExperience } from '../../components/AskExperience'
import { BrandConfig, resolveBrand, listBrandSlugs } from '../../lib/brands'
import { getCorpus } from '../../lib/corpora'
import { getCorpusStats } from '../../lib/rag'
import { CorpusStats } from '../../lib/types'

export default function BrandedDemo({ brand, corpusStats }: { brand: BrandConfig; corpusStats: CorpusStats }) {
  const corpus = getCorpus(brand.corpusId)
  const title = brand.displayName ? `${brand.displayName} — ${corpus.label}` : corpus.label
  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <AskExperience brand={brand} corpusStats={corpusStats} />
    </>
  )
}

export const getStaticPaths: GetStaticPaths = async () => {
  const paths = listBrandSlugs().map((slug) => ({ params: { brand: slug } }))
  // fallback: 'blocking' so an unrecognized /demo/<brand> still renders
  // (resolveBrand falls back to the security corpus's neutral default)
  // instead of 404ing.
  return { paths, fallback: 'blocking' }
}

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const brandParam = typeof params?.brand === 'string' ? params.brand : undefined
  const brand = resolveBrand(brandParam)
  const corpusStats = getCorpusStats(brand.corpusId)
  return { props: { brand, corpusStats } }
}
