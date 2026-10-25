import type { NextConfig } from 'next';
import { join } from 'node:path';

/** account zone — served under /account (the shell rewrites /account/* here). */
const nextConfig: NextConfig = {
  basePath: '/account',
  output: 'standalone',
  outputFileTracingRoot: join(process.cwd(), '../..'),
  poweredByHeader: false,
};

export default nextConfig;
