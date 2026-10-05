import Head from 'next/head'
import { GetStaticProps } from 'next'
import { AskExperience } from '../components/AskExperience'
import { BrandConfig, resolveBrand } from '../lib/brands'
import { getCorpus } from '../lib/corpora'
import { getCorpusStats } from '../lib/rag'
import { CorpusStats } from '../lib/types'

// The neutral governance-corpus demo. It used to live at /demo/governance (still
// redirected here from next.config.js) and, for security, at the bare root.
export default function GovernanceDemo({ brand, corpusStats }: { brand: BrandConfig; corpusStats: CorpusStats }) {
  const corpus = getCorpus(brand.corpusId)
  return (
    <>
      <Head>
        <title>{corpus.label}</title>
      </Head>
      <AskExperience brand={brand} corpusStats={corpusStats} />
    </>
  )
}

export const getStaticProps: GetStaticProps = async () => {
  const brand = resolveBrand('governance')
  const corpusStats = getCorpusStats(brand.corpusId)
  return { props: { brand, corpusStats } }
}
