# ADR 0015 — Agent identity: the `agents` client token (no token exchange for event-driven runs)

- **Status:** Accepted (2026-10-24)
- **Related:** [03 §3.3](../03-agentic-ai.md#33-governance-model), [03 §3.10 as built](../03-agentic-ai.md#310-as-built-p3-2026-10-24), [02 §2.7](../02-lld.md#27-returns--refunds-service), ADR 0014

## Context

The governed refund agent calls the returns service (case context, policy evaluation, proposals, evidence requests,
refund execution) and the fraud service (risk). The design (03 §3.3) asked for agent tokens obtained by OAuth token
exchange (RFC 8693) carrying `act = agent:<id>` and narrow scopes (`refunds:propose`, `refunds:execute:auto` only at L3+).

Facts found while building P3:

- Keycloak 26.8 supports **standard token exchange v2** (the `agents` client already has
  `standard.token.exchange.enabled`). V2 exchanges a **subject token** (a user's access token) for another audience.
  It does not do impersonation without a subject token, and it does not add an `act` claim.
- The refund agent's main trigger is an **event** (`returns.return_requested.v1`) consumed by the agents service.
  There is no buyer access token at that point, so there is nothing to exchange.
- Per-autonomy scope downscoping needs custom **client scopes**. Defining them in the realm import JSON makes Keycloak
  skip its built-in client scopes (profile, email, roles), which would break every other client. Adding them after
  import needs a bootstrap step in both the local stack and k8s.

## Decision

1. **Event-driven and admin-triggered runs use the `agents` client's own client-credentials token**
   (`KEYCLOAK_AGENTS_CLIENT_SECRET`, `ServiceClient` with `credentials: { clientId: 'agents' }`). Its service account
   has realm roles `service` (internal endpoints) and `agent`.
2. **Attribution:** every call carries `X-Agent-Act: agent:<id>`. The shared guard (`@ac/nest-common`) copies it into
   `principal.actor` **only when the token's `azp` is the agents client** (`AGENT_CLIENT_ID`, default `agents`) and the
   value matches `agent:[a-z0-9-]+`. Another client's token can never claim to be an agent. No HMAC is needed: forging
   the header requires the agents client's credentials anyway. Returns stores the actor on proposals, decisions and
   refunds (`agent:refund run <runId>`).
3. **Money stays fenced without per-run scopes**, in layers:
   - the agents service re-reads autonomy before every WRITE/MONEY call;
   - OPA allows MONEY only inside the envelope, over facts the agents service loads server-side (fresh case status,
     refundable amount, fresh risk, fresh policy result);
   - returns executes only `AUTO_APPROVED` cases that its own re-evaluated policy put there;
   - payment caps refunds at the captured amount.
4. **Interactive runs (AG-UI, P4)** will use standard token exchange v2: buyer token → agents audience. Ownership is
   enforced by the services with the buyer's identity, and the actor still comes from `X-Agent-Act`.
5. **Later:** client scopes `refunds:propose` and `refunds:execute:auto`, created by an idempotent bootstrap
   (`ac infra init` + the k8s db-bootstrap job). The agents service would then request `refunds:execute:auto` only at
   L3+, and returns can require it on `/execute` (it already accepts agent tokens with that scope).

## Consequences

- Works today in local and k8s without destructive Keycloak changes; the realm JSON only gains role `agent` and the
  agents service-account mapping.
- The agents service is a privileged caller (role `service`). Its blast radius is bounded by the invoker, OPA and
  returns' own checks, and every call is in the hash-chained audit.
- Per-autonomy token scopes remain future work (5).
