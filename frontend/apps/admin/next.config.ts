import type { NextConfig } from 'next';
import { join } from 'node:path';

/** admin zone — served under /admin (the shell rewrites /admin/* here). */
const nextConfig: NextConfig = {
  basePath: '/admin',
  output: 'standalone',
  outputFileTracingRoot: join(process.cwd(), '../..'),
  poweredByHeader: false,
};

export default nextConfig;
