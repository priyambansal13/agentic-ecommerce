import 'server-only';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers.js';
import { createHash } from 'node:crypto';

/**
 * One login for the whole site: every zone is served through the shell's origin, so the encrypted httpOnly
 * session cookie set by the shell's /api/auth/callback is readable by every zone's server code (never by JS).
 * Encryption key = SHA-256(AUTH_SECRET) — the same secret in every zone (Secret zone-<name> / .env.local).
 */
export type Realm = 'customers' | 'staff';
export interface Session {
  realm: Realm;
  sub: string;
  name: string;
  email?: string;
  roles: string[];
  accessToken: string;
  /** epoch seconds */
  expiresAt: number;
}

export const SESSION_COOKIE = 'ac_session';
const key = () => {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET is not set — run `ac configure` (platform repo)');
  return createHash('sha256').update(process.env.AUTH_SECRET).digest();
};

export async function sealSession(s: Session) {
  return new EncryptJWT({ ...s }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().setExpirationTime(s.expiresAt).encrypt(key());
}
export async function seal(payload: Record<string, unknown>, ttlSeconds: number) {
  return new EncryptJWT(payload).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setExpirationTime(`${ttlSeconds}s`).encrypt(key());
}
export async function unseal<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    return (await jwtDecrypt(token, key())).payload as T;
  } catch {
    return null;
  }
}

/** The signed-in user, or null (no cookie, tampered, or access token about to expire → re-login via SSO). */
export async function getSession(): Promise<Session | null> {
  const s = await unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s || s.expiresAt * 1000 < Date.now() + 30_000) return null;
  return s;
}

export const hasRole = (s: Session | null, ...roles: string[]) => !!s && roles.some((r) => s.roles.includes(r));

/** Login URL (shell route). Keycloak's SSO session makes a re-login after token expiry a silent redirect. */
/** Absolute on purpose: next/navigation redirect() inside a zone would otherwise prefix the zone's basePath. */
export const loginUrl = (realm: Realm, returnTo: string) =>
  `${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300').replace(/\/$/, '')}/api/auth/login?realm=${realm}&returnTo=${encodeURIComponent(returnTo)}`;
