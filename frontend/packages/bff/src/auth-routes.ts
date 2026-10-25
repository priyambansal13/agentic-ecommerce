import 'server-only';
import * as oidc from 'openid-client';
import { cookies } from 'next/headers.js';
import { decodeJwt } from 'jose';
import { mergeGuestCart } from './cart.js';
import { type Realm, SESSION_COOKIE, seal, sealSession, unseal } from './session.js';

/**
 * OIDC Authorization Code + PKCE against Keycloak, mounted by the SHELL zone only:
 *   src/app/api/auth/[action]/route.ts →  export const { GET } = authRoutes();
 * Env (server-only): AUTH_SECRET, NEXT_PUBLIC_APP_URL, AUTH_ISSUER_BASE (public Keycloak base, e.g.
 * http://localhost:58180 or https://<domain>/auth), AUTH_CUSTOMERS_CLIENT_ID/SECRET, AUTH_STAFF_CLIENT_ID/SECRET,
 * optional AUTH_INTERNAL_BASE (k8s: http://keycloak.ac-infra.svc.cluster.local:8080/auth — server-to-server
 * calls go there while the browser and the token issuer keep the public URL).
 */
const realmEnv = (realm: Realm) => {
  const prefix = realm === 'staff' ? 'AUTH_STAFF' : 'AUTH_CUSTOMERS';
  return { clientId: process.env[`${prefix}_CLIENT_ID`] ?? (realm === 'staff' ? 'web-admin' : 'web'), clientSecret: process.env[`${prefix}_CLIENT_SECRET`] ?? '' };
};
const publicBase = () => (process.env.AUTH_ISSUER_BASE ?? 'http://localhost:58180').replace(/\/$/, '');
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300').replace(/\/$/, '');
const issuerFor = (realm: Realm) => `${publicBase()}/realms/${realm}`;

const configs = new Map<Realm, Promise<oidc.Configuration>>();
function config(realm: Realm) {
  if (!configs.has(realm)) {
    const internal = process.env.AUTH_INTERNAL_BASE?.replace(/\/$/, '');
    const rewrite: oidc.CustomFetch = (url, options) => fetch(internal ? url.replace(publicBase(), internal) : url, options as RequestInit);
    const { clientId, clientSecret } = realmEnv(realm);
    configs.set(
      realm,
      oidc.discovery(new URL(issuerFor(realm)), clientId, clientSecret, undefined, {
        [oidc.customFetch]: rewrite,
        execute: publicBase().startsWith('http://') ? [oidc.allowInsecureRequests] : [],
      }),
    );
  }
  return configs.get(realm)!;
}
const safeReturn = (p: string | null) => (p && p.startsWith('/') && !p.startsWith('//') ? p : '/');
const cookieOpts = (maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: appUrl().startsWith('https://'), path: '/', maxAge });

export function authRoutes() {
  async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
    const { action } = await ctx.params;
    const url = new URL(req.url);
    const jar = await cookies();

    if (action === 'login') {
      const realm: Realm = url.searchParams.get('realm') === 'staff' ? 'staff' : 'customers';
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      jar.set('ac_oidc', await seal({ realm, verifier, state, returnTo: safeReturn(url.searchParams.get('returnTo')) }, 600), cookieOpts(600));
      const target = oidc.buildAuthorizationUrl(await config(realm), {
        redirect_uri: `${appUrl()}/api/auth/callback`,
        scope: 'openid profile email',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
      });
      return Response.redirect(target.href, 302);
    }

    if (action === 'callback') {
      const pending = await unseal<{ realm: Realm; verifier: string; state: string; returnTo: string }>(jar.get('ac_oidc')?.value);
      if (!pending) return Response.redirect(`${appUrl()}/`, 302);
      // build the callback URL from the configured public app URL (proxies may rewrite scheme/host)
      const current = new URL(`${appUrl()}/api/auth/callback${url.search}`);
      const tokens = await oidc.authorizationCodeGrant(await config(pending.realm), current, { pkceCodeVerifier: pending.verifier, expectedState: pending.state });
      const at = decodeJwt(tokens.access_token) as Record<string, any>;
      const session = await sealSession({
        realm: pending.realm,
        sub: String(at.sub),
        name: String(at.name ?? at.preferred_username ?? 'user'),
        email: at.email,
        roles: at.realm_access?.roles?.filter((r: string) => !r.startsWith('default-roles') && !['offline_access', 'uma_authorization'].includes(r)) ?? [],
        accessToken: tokens.access_token,
        expiresAt: Number(at.exp),
      });
      jar.delete('ac_oidc');
      jar.set(SESSION_COOKIE, session, cookieOpts(Math.max(60, Number(at.exp) - Math.floor(Date.now() / 1000))));
      // a guest cart follows the buyer into their account (best effort; the cart page retries if this fails)
      if (pending.realm === 'customers') await mergeGuestCart(tokens.access_token);
      return Response.redirect(`${appUrl()}${pending.returnTo}`, 302);
    }

    if (action === 'logout') {
      const s = await unseal<{ realm: Realm }>(jar.get(SESSION_COOKIE)?.value);
      jar.delete(SESSION_COOKIE);
      const realm = s?.realm ?? 'customers';
      const end = new URL(`${issuerFor(realm)}/protocol/openid-connect/logout`);
      end.searchParams.set('client_id', realmEnv(realm).clientId);
      end.searchParams.set('post_logout_redirect_uri', `${appUrl()}/`);
      return Response.redirect(end.href, 302);
    }
    return Response.json({ error: 'unknown auth action' }, { status: 404 });
  }
  return { GET };
}
