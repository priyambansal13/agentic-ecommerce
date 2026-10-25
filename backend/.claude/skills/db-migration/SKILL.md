---
name: db-migration
description: "Use when creating or changing tables, columns or indexes in any microservice's own Postgres database in agentic-commerce backend — TypeORM migrations scoped to that service's database, zero-downtime expand/contract, money as bigint minor units, encrypted PII columns. Trigger on \"add column\", \"new table\", \"migration\", \"change entity\"."
---

# Database migration (database-per-service)

Each microservice owns exactly one database `ac_<database>` (`"ac".database` in its `package.json`;
local Postgres `localhost:55432`) and connects as role `svc_<database>` through its own `DATABASE_URL`
(`services/<svc>/.env`). Migrations live in `services/<svc>/src/migrations/` and run with the service's
own role — it has no access to any other service's database (by design). Need another service's data?
Call its API or consume its events into a local read model; never a cross-database query or FDW.

## 1. Change the entity
```ts
@Entity({ name: 'refunds' })
export class RefundEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { unique: true, name: 'refund_case_id' }) refundCaseId: string;   // idempotency anchor
  @Column('bigint', { name: 'amount_minor' }) amountMinor: string;                  // bigint → string in pg driver
  @Column('char', { length: 3 }) currency: string;
  @Column('text') status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  @VersionColumn() version: number;                                                 // optimistic locking
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' }) createdAt: Date;
}
```
Conventions: snake_case columns, `timestamptz` only, `uuid` PKs (ULID/uuid v7 generated in app), money =
`bigint *_minor` + `currency`, enums as `text` + CHECK constraint (easier to evolve than PG enums),
PII as `*_enc` (`bytea`, app-side KMS/pgcrypto), JSON as `jsonb`.

## 2. Generate & review
```bash
pnpm --filter @ac/<svc> exec typeorm migration:generate src/migrations/<Name> -d dist/data-source.js
# or hand-write: migration:create
```
Always read the generated SQL. It must only touch this service's tables. `synchronize` is **false** everywhere.

## 3. Zero-downtime rules (expand → migrate → contract)
| Change | Do | Don't |
|---|---|---|
| Add column | nullable or with constant default | NOT NULL without default on big tables |
| Rename column | add new, dual-write, backfill, switch reads, drop old in a later release | `RENAME COLUMN` in one go |
| Drop column | stop reading → release → drop | drop while old pods read it |
| Index | `CREATE INDEX CONCURRENTLY` (set `transaction = false` on the migration) | blocking index on hot tables |
| Type change | new column + backfill | `ALTER TYPE` on large tables |
| Backfill | batched job (BullMQ) with `LIMIT` + sleep | one giant `UPDATE` |

## 4. Invariants as constraints
Put invariants in the DB where cheap:
```sql
ALTER TABLE stock ADD CONSTRAINT stock_non_negative CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand);
ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive CHECK (amount_minor > 0);
```
Ledger balance is enforced by a deferred constraint trigger (`Σdebit = Σcredit` per tx) — keep it.

## 5. Run & test
```bash
node ../platform/scripts/ac.mjs infra up && node ../platform/scripts/ac.mjs infra init   # creates ac_<database> + role
pnpm --filter @ac/<svc> exec typeorm migration:run -d dist/data-source.js
pnpm --filter @ac/<svc> exec typeorm migration:revert -d dist/data-source.js   # must work
```
Integration tests run migrations against a fresh Testcontainers Postgres (one container per service test
suite). Migrations run at deploy time for **that service only** (init container of its Kubernetes Deployment, or
`migration:run` on boot before readiness) before the new version takes traffic — independent of other services' releases.

## 6. Docs
Update the ER diagram for the service in `../platform/docs/02-lld.md` and the service card (`services/<svc>/README.md`).

## Checklist
- [ ] Only this service's database touched; no cross-service reads
- [ ] Money `bigint *_minor` + currency; timestamps `timestamptz`; PII encrypted
- [ ] Expand/contract respected; concurrent indexes
- [ ] Invariants as CHECK/unique constraints (idempotency anchors unique)
- [ ] `up` and `down` both run locally
- [ ] Previous service version still works against the migrated schema (independent rollback)
- [ ] LLD ER diagram + service card updated
