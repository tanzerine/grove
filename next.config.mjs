/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  // Type errors now fail the build (the codebase type-checks clean as of the
  // calendar work). This stops latent bugs like the manager-gate body_md
  // mismatch from silently shipping again. ESLint stays non-blocking.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
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
