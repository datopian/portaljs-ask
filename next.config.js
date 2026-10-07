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
      beforeFiles: [
        { source: '/', destination: `/p/${defaultPortal}/index.html` },
        ...portalSlugs.map((slug) => ({ source: `/demo/${slug}`, destination: `/p/${slug}/index.html` })),
      ],
    }
  },
}

module.exports = nextConfig
