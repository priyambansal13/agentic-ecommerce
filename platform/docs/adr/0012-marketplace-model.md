# ADR 0012 — Amazon-style marketplace model and fee schedule

- **Status:** Accepted (2026-10-23)
- **Related:** [10-marketplace.md](../10-marketplace.md), [07](../07-microservices.md), [09](../09-dashboards.md)

## Context

The application needs to answer who may list products (companies, manufacturers, brand owners), who
approves each step, and what commission the platform earns — and show all of it in the app. Options
considered:

1. **Amazon model**: seller accounts with KYC, Brand Registry, one shared catalogue with many offers per
   product, gated categories, moderated new listings; per-category referral fee + closing fee + payment
   fee + GST, versioned.
2. **Simple marketplace**: each seller lists its own products (no shared catalogue, no brands), one flat
   commission %.
3. **Curated/first-party**: only staff list products; suppliers onboarded offline.

## Decision

Option 1, chosen by the product owner.

- Seller accounts and KYC (GSTIN, PAN, bank) live in the **user** service; compliance verifies; the user
  service grants the Keycloak `seller` realm role through a dedicated client (`user-service`, manage-users)
  so Seller Central stays gated by a role checked in every service.
- Brands, categories, products, offers and the listing rules live in **catalog**, with a local
  `seller_eligibility` read model fed by `user.events` (no synchronous call on the listing path).
- Moderation stays in **admin**; a rules pre-screen may auto-approve only low-risk listings
  (`decided_by = agent`), everything else goes to a moderator.
- Fees live in **payment**: a versioned schedule with maker-checker (creator/submitter can never approve),
  `order_fees` stamped with the schedule version, FEE ledger entries.
- New staff roles `compliance`, `brand-team`, `category-team`; contracts 0.4.0 (additive) and six events.

## Consequences

- Clear ownership and an audit trail per approval; brand owners self-serve reseller control; history
  never changes when fees change.
- Eventual consistency: a newly verified seller can list a few seconds after the event is consumed.
- A newly verified seller must sign in again to receive the `seller` role in their token.
- More services take part in one business flow — covered by events and the docs' sequence diagrams.
- KYC checks are format-level only until GSTN/bank verification APIs are integrated.
