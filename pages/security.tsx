import Head from 'next/head'
import { GetStaticProps } from 'next'
import { AskExperience } from '../components/AskExperience'
import { BrandConfig, resolveBrand } from '../lib/brands'
import { getCorpus } from '../lib/corpora'
import { getCorpusStats } from '../lib/rag'
import { CorpusStats } from '../lib/types'

// The neutral security-corpus demo. It used to live at /demo/security (still
// redirected here from next.config.js) and, for security, at the bare root.
export default function SecurityDemo({ brand, corpusStats }: { brand: BrandConfig; corpusStats: CorpusStats }) {
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
  const brand = resolveBrand('security')
  const corpusStats = getCorpusStats(brand.corpusId)
  return { props: { brand, corpusStats } }
}
