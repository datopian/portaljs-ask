const fs = require('fs')
const path = require('path')

// Data portals (portals/<slug>/, see ARCHITECTURE.md) are static pages built
// by scripts/build-portals.mjs into public/p/<slug>/.
const portalsDir = path.join(__dirname, 'portals')
const defaultPortal = JSON.parse(fs.readFileSync(path.join(portalsDir, 'index.json'), 'utf8')).default
const portalSlugs = fs.readdirSync(portalsDir).filter((f) => fs.statSync(path.join(portalsDir, f)).isDirectory())

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pages/api/share.ts reads the built portal pages.
    outputFileTracingIncludes: { '/api/share': ['./public/p/**/*'] },
  },
  async redirects() {
    // The neutral demos moved from /demo/<corpus> to /<corpus>; keep links
    // already sent in sales emails working. Not permanent, so browsers don't
    // cache it if the routes move again.
    return [
      { source: '/demo/security', destination: '/security', permanent: false },
      { source: '/demo/governance', destination: '/governance', permanent: false },
    ]
  },
  async rewrites() {
    // The homepage is the default portal; every portal is also at /demo/<slug>.
    return {
      // A shared answer (?q=...) goes through pages/api/share.ts, which puts the
      // answer's headline in the page's link preview; the page itself is the same.
      beforeFiles: [
        { source: '/', has: [{ type: 'query', key: 'q' }], destination: `/api/share?portal=${defaultPortal}` },
        { source: '/', destination: `/p/${defaultPortal}/index.html` },
        ...portalSlugs.flatMap((slug) => [
          { source: `/demo/${slug}`, has: [{ type: 'query', key: 'q' }], destination: `/api/share?portal=${slug}` },
          { source: `/demo/${slug}`, destination: `/p/${slug}/index.html` },
        ]),
      ],
    }
  },
}

module.exports = nextConfig
