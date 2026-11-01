import path from 'node:path';
import type { NextConfig } from 'next';

const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: trace workspace packages from the repository root.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@latex-cloud/ui'],
  webpack(config) {
    // pdfjs-dist references the optional Node "canvas" package; never bundle it.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
  // The browser only ever talks to this origin; /api is proxied to the API so
  // session cookies stay first-party and SameSite=Lax applies.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
