/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  skipTrailingSlashRedirect: true,
  // Covers + inline images live in Supabase Storage. Serving them through
  // next/image (and lib/image-cdn.ts for markdown-rendered bodies) puts them
  // behind Vercel's image CDN, so blog traffic stops draining Supabase egress
  // (free tier: 5 GB/mo — a few thousand pageviews).
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
  // Type errors now fail the build (the codebase type-checks clean as of the
  // calendar work). This stops latent bugs like the manager-gate body_md
  // mismatch from silently shipping again. ESLint stays non-blocking.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [
      // OAuth discovery for the MCP endpoint (RFC 9728). Served from a normal
      // route and rewritten onto the reserved .well-known namespace: a literal
      // `app/.well-known/` directory is not a shape the App Router's file
      // scanner is reliable about. Both forms are served — the RFC builds the
      // URL by inserting the well-known segment before the resource's path
      // (/api/mcp), and that is what the 401 challenge names, while several
      // clients probe the bare path first.
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/oauth/protected-resource',
      },
      // RFC 8414. Clients also probe the OpenID variant, which carries the
      // same document — supporting both costs one line and saves a dead end.
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/oauth/authorization-server',
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/oauth/authorization-server',
      },
      {
        source: '/.well-known/openid-configuration',
        destination: '/api/oauth/authorization-server',
      },
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://us-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/embed.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=300' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
      {
        source: '/api/embed/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
      // Baseline hardening on every response.
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
      // The authenticated app must never be framed (clickjacking). Blogs under
      // /b/ stay frameable so customers can embed them if they want.
      {
        source: '/dashboard/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      // The OAuth consent screen most of all: its one button grants an agent
      // access to the customer's content, which is precisely what a clickjack
      // would want to borrow a click for.
      {
        source: '/oauth/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};
export default nextConfig;
