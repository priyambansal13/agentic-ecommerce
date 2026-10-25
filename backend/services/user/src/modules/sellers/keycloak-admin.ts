import { Injectable, Logger } from '@nestjs/common';

/**
 * Grants the customers-realm `seller` role through the Keycloak Admin API (client `user-service`,
 * client-credentials, realm-management manage-users). Best effort: called after the KYC transaction commits;
 * a failure is logged and can be retried (role_granted_at stays NULL).
 * Admin base is derived from the customers issuer in OIDC_ISSUERS, with OIDC_JWKS_REWRITE applied (in-cluster URL).
 */
@Injectable()
export class KeycloakAdmin {
  private readonly log = new Logger(KeycloakAdmin.name);

  private realmBase() {
    const iss = (process.env.OIDC_ISSUERS ?? '').split(',').map((s) => s.trim()).find((s) => s.endsWith('/realms/customers'));
    if (!iss) return null;
    const [from, to] = (process.env.OIDC_JWKS_REWRITE ?? '').split('=');
    return from && to && iss.startsWith(from) ? to + iss.slice(from.length) : iss;
  }

  async grantRealmRole(userId: string, role: string): Promise<boolean> {
    const base = this.realmBase();
    const secret = process.env.KEYCLOAK_USER_SERVICE_CLIENT_SECRET;
    if (!base || !secret) {
      this.log.warn(`cannot grant ${role} to ${userId}: customers issuer or KEYCLOAK_USER_SERVICE_CLIENT_SECRET missing`);
      return false;
    }
    const admin = base.replace('/realms/', '/admin/realms/');
    const timeout = () => AbortSignal.timeout(3000);
    try {
      const tok = await fetch(`${base}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'user-service', client_secret: secret }),
        signal: timeout(),
      });
      if (!tok.ok) throw new Error(`token ${tok.status}`);
      const { access_token } = (await tok.json()) as { access_token: string };
      const auth = { authorization: `Bearer ${access_token}` };
      const rep = await fetch(`${admin}/roles/${encodeURIComponent(role)}`, { headers: auth, signal: timeout() });
      if (!rep.ok) throw new Error(`role lookup ${rep.status}`);
      const res = await fetch(`${admin}/users/${userId}/role-mappings/realm`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify([await rep.json()]),
        signal: timeout(),
      });
      if (!res.ok) throw new Error(`role mapping ${res.status}`);
      this.log.log(`granted realm role ${role} to ${userId}`);
      return true;
    } catch (e) {
      this.log.error(`granting ${role} to ${userId} failed (retry later): ${(e as Error).message}`);
      return false;
    }
  }
}
