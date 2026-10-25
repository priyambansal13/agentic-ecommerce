import type { NextConfig } from 'next';
import { join } from 'node:path';

/** seller zone — served under /seller (the shell rewrites /seller/* here). */
const nextConfig: NextConfig = {
  basePath: '/seller',
  output: 'standalone',
  outputFileTracingRoot: join(process.cwd(), '../..'),
  poweredByHeader: false,
  // Add a product posts up to 5 photos × 5 MB through a Server Action (catalog re-validates every file)
  experimental: { serverActions: { bodySizeLimit: '26mb' } },
};

export default nextConfig;
