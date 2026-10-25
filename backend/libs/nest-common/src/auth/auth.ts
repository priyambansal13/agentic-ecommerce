import { type CanActivate, createParamDecorator, type ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';

export const IS_PUBLIC = 'ac:public';
export const ROLES = 'ac:roles';
export const SCOPES = 'ac:scopes';
/** Route needs no token (health checks, gateway webhooks with their own signature check). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Any of these realm roles (buyer, seller, admin, support, finance, fraud-analyst, moderator). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);
/** All of these OAuth scopes (agent tokens carry narrowed scopes, e.g. refunds:propose). */
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES, scopes);

export interface PrincipalInfo {
  /** user id (Keycloak sub) — for agent tokens this is still the user the agent acts for */
  sub: string;
  realm: string;
  roles: string[];
  scopes: string[];
  /** set when an agent acts on behalf of the user (RFC 8693 `act` claim), e.g. "agent:refund" — or, for tokens of
   *  the `agents` client (azp), from the `X-Agent-Act` header (see AGENT_CLIENT_ID; ADR 0015) */
  actor?: string;
  /** authorized party (client id) of the token */
  azp?: string;
  /** optional OIDC profile claims (present for interactive users) */
  email?: string;
  name?: string;
  token: string;
}

/** Inject the verified principal: `@Principal() p: PrincipalInfo`. */
export const Principal = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().principal as PrincipalInfo);

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const issuers = () => (process.env.OIDC_ISSUERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Tokens carry the PUBLIC issuer (https://<domain>/auth/realms/…), but inside the cluster keys should be fetched
 * from Keycloak directly: OIDC_JWKS_REWRITE="https://<domain>/auth=http://keycloak.ac-infra.svc.cluster.local:8080/auth".
 * The issuer check itself always uses the public value.
 */
function jwksUrl(iss: string) {
  const [from, to] = (process.env.OIDC_JWKS_REWRITE ?? '').split('=');
  const base = from && to && iss.startsWith(from) ? to + iss.slice(from.length) : iss;
  return new URL(`${base}/protocol/openid-connect/certs`);
}

/** Verify a `Bearer` Authorization header against the trusted Keycloak issuers (OIDC_ISSUERS). */
export async function verifyBearer(header: string | undefined): Promise<PrincipalInfo> {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) throw new UnauthorizedException('missing bearer token');
  let iss: string | undefined;
  try {
    iss = decodeJwt(token).iss;
  } catch {
    throw new UnauthorizedException('malformed token');
  }
  if (!iss || !issuers().includes(iss)) throw new UnauthorizedException('untrusted issuer');
  if (!jwks.has(iss)) jwks.set(iss, createRemoteJWKSet(jwksUrl(iss)));
  let payload: JWTPayload & Record<string, any>;
  try {
    ({ payload } = await jwtVerify(token, jwks.get(iss)!, { issuer: iss, audience: process.env.OIDC_AUDIENCE || undefined }));
  } catch (e) {
    throw new UnauthorizedException(`invalid token: ${(e as Error).message}`);
  }
  return {
    sub: String(payload.sub),
    realm: iss.split('/realms/')[1] ?? '',
    roles: payload.realm_access?.roles ?? [],
    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
    actor: payload.act?.sub ? String(payload.act.sub) : undefined,
    azp: typeof payload.azp === 'string' ? payload.azp : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
    token,
  };
}

/** Global guard: verifies Keycloak JWTs (customers + staff realms) against JWKS, then roles/scopes metadata. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const principal = await verifyBearer(req.headers?.authorization);
    // Agent attribution (ADR 0015): only a token issued to the agents client may name the acting agent.
    const act = req.headers?.['x-agent-act'];
    if (!principal.actor && typeof act === 'string' && principal.azp === (process.env.AGENT_CLIENT_ID ?? 'agents') && /^agent:[a-z0-9-]{1,40}$/.test(act)) principal.actor = act;
    req.principal = principal;

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, targets);
    if (roles?.length && !roles.some((r) => principal.roles.includes(r))) throw new ForbiddenException('missing role');
    const scopes = this.reflector.getAllAndOverride<string[]>(SCOPES, targets);
    if (scopes?.length && !scopes.every((s) => principal.scopes.includes(s))) throw new ForbiddenException('missing scope');
    return true;
  }
}
