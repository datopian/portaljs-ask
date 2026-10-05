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
    // The homepage is the static "Ask Toronto's data" prototype.
    return { beforeFiles: [{ source: '/', destination: '/home.html' }] }
  },
}

module.exports = nextConfig
