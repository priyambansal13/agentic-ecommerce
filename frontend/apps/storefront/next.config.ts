import type { NextConfig } from 'next';
import { join } from 'node:path';

/** storefront zone — served under /shop (the shell rewrites /shop/* here). */
const nextConfig: NextConfig = {
  basePath: '/shop',
  output: 'standalone',
  outputFileTracingRoot: join(process.cwd(), '../..'),
  poweredByHeader: false,
};

export default nextConfig;
