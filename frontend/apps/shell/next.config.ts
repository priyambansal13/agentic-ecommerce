import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shell zone: owns '/', and rewrites each zone's basePath to that zone (Next.js Multi-Zones).
 * Zone URLs: ZONE_<NAME>_URL (Kubernetes Service names zone-<name> in Docker builds) else http://localhost:<port>.
 * Rewrites are resolved at BUILD time for standalone output — set the env/build args before `next build`.
 */
interface Zone {
  name: string;
  port: number;
  basePath: string;
}
const { zones } = JSON.parse(readFileSync(join(process.cwd(), '../../zones.json'), 'utf8')) as { zones: Zone[] };
const zoneUrl = (z: Zone) => process.env[`ZONE_${z.name.toUpperCase().replace(/-/g, '_')}_URL`] ?? `http://localhost:${z.port}`;

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: join(process.cwd(), '../..'),
  poweredByHeader: false,
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: zones
        .filter((z) => z.basePath)
        .flatMap((z) => [
          { source: z.basePath, destination: `${zoneUrl(z)}${z.basePath}` },
          { source: `${z.basePath}/:path*`, destination: `${zoneUrl(z)}${z.basePath}/:path*` },
        ]),
      // Local dev only: /api/<service>/v1/* (public images) → Kong. In k8s the Ingress routes /api to Kong before
      // the shell; `fallback` runs after the shell's own routes, so /api/auth/* still wins. Tokens never pass here.
      fallback: [{ source: '/api/:service/v1/:path*', destination: `${(process.env.KONG_URL ?? 'http://localhost:58000').replace(/\/$/, '')}/api/:service/v1/:path*` }],
    };
  },
};

export default nextConfig;
