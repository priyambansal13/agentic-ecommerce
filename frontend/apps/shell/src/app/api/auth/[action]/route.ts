import { authRoutes } from '@ac/bff';

/** /api/auth/login?realm=customers|staff&returnTo=… · /api/auth/callback · /api/auth/logout — for every zone. */
export const dynamic = 'force-dynamic';
export const { GET } = authRoutes();
