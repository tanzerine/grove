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
    ];
  },
};
export default nextConfig;
