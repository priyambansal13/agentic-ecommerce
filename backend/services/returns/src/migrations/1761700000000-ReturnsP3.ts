import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P3 returns backbone (expand-only): return requests + items, evidence, decisions history, versioned refund
 * policies, agent proposals kept apart from decisions, and the extra refund_cases columns. Widens the status /
 * decided_by CHECK constraints (FAILED, APPEALED; decided_by 'policy').
 */
export class ReturnsP31761700000000 implements MigrationInterface {
  name = 'ReturnsP31761700000000';

  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE refund_cases DROP CONSTRAINT IF EXISTS refund_cases_status_check;
      ALTER TABLE refund_cases ADD CONSTRAINT refund_cases_status_check CHECK (status IN
        ('REQUESTED','GATHERING_EVIDENCE','AWAITING_BUYER','PROPOSED','AUTO_APPROVED','PENDING_HUMAN','APPROVED','REJECTED',
         'REFUND_PENDING','REFUNDED','FAILED','APPEALED','CLOSED'));
      ALTER TABLE refund_cases DROP CONSTRAINT IF EXISTS refund_cases_decided_by_check;
      ALTER TABLE refund_cases ADD CONSTRAINT refund_cases_decided_by_check CHECK (decided_by IS NULL OR decided_by IN ('agent','human','policy'));
      ALTER TABLE refund_cases
        ADD COLUMN IF NOT EXISTS return_request_id uuid,
        ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS resolution text CHECK (resolution IS NULL OR resolution IN ('REFUND','PARTIAL_REFUND','REPLACEMENT','STORE_CREDIT','REJECT')),
        ADD COLUMN IF NOT EXISTS policy_version text,
        ADD COLUMN IF NOT EXISTS policy jsonb,
        ADD COLUMN IF NOT EXISTS preferred text CHECK (preferred IS NULL OR preferred IN ('REFUND','REPLACEMENT')),
        ADD COLUMN IF NOT EXISTS buyer_text text,
        ADD COLUMN IF NOT EXISTS dual_control boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS agent_run_id text,
        ADD COLUMN IF NOT EXISTS refund_id uuid,
        ADD COLUMN IF NOT EXISTS first_approver text,
        ADD COLUMN IF NOT EXISTS first_approval jsonb,
        ADD COLUMN IF NOT EXISTS decision_note text,
        ADD COLUMN IF NOT EXISTS explanation text,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      CREATE INDEX IF NOT EXISTS refund_cases_order ON refund_cases (order_id);

      CREATE TABLE return_requests (
        id uuid PRIMARY KEY,
        order_id uuid NOT NULL,
        order_no text NOT NULL,
        buyer_id uuid NOT NULL,
        seller_id uuid NOT NULL,
        reason_code text NOT NULL CHECK (reason_code IN ('DAMAGED','WRONG_ITEM','NOT_AS_DESCRIBED','NOT_DELIVERED','CHANGED_MIND','LATE')),
        buyer_text text NOT NULL,
        preferred text NOT NULL CHECK (preferred IN ('REFUND','REPLACEMENT')),
        -- order/tracking/buyer-history facts captured at request time (data-minimised: city + pincode only)
        snapshot jsonb NOT NULL,
        signals jsonb NOT NULL DEFAULT '[]',
        appeal_note text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX return_requests_buyer ON return_requests (buyer_id, created_at DESC);
      CREATE INDEX return_requests_order ON return_requests (order_id);
      CREATE TABLE return_items (
        return_request_id uuid NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
        product_id uuid NOT NULL,
        title text NOT NULL,
        category text NOT NULL,
        qty int NOT NULL CHECK (qty > 0),
        unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
        PRIMARY KEY (return_request_id, product_id)
      );
      CREATE TABLE evidence (
        id uuid PRIMARY KEY,
        case_id uuid NOT NULL,
        kind text NOT NULL CHECK (kind IN ('PHOTO','TRACKING','BUYER_TEXT','SELLER_RESPONSE','ORDER_SNAPSHOT')),
        object_prefix text,
        findings jsonb,
        uploaded_by text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX evidence_case ON evidence (case_id, created_at);
      CREATE INDEX evidence_dhash ON evidence ((findings->>'dhash')) WHERE kind = 'PHOTO';
      CREATE TABLE decisions (
        id bigserial PRIMARY KEY,
        case_id uuid NOT NULL,
        actor text NOT NULL,
        outcome text NOT NULL,
        amount_minor bigint,
        policy_version text,
        note text,
        rationale jsonb,
        from_status text,
        to_status text,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX decisions_case ON decisions (case_id, at);
      CREATE TABLE refund_policies (
        version text PRIMARY KEY,
        rules jsonb NOT NULL,
        effective_from timestamptz NOT NULL,
        approved_by text NOT NULL,
        active boolean NOT NULL DEFAULT false
      );
      CREATE UNIQUE INDEX refund_policies_one_active ON refund_policies (active) WHERE active;
      CREATE TABLE proposals (
        id uuid PRIMARY KEY,
        case_id uuid NOT NULL,
        run_id text NOT NULL,
        mode text NOT NULL CHECK (mode IN ('SHADOW','RECOMMEND','LIVE')),
        outcome text NOT NULL CHECK (outcome IN ('REFUND','PARTIAL_REFUND','REPLACEMENT','STORE_CREDIT','REJECT')),
        amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
        confidence numeric(4,3) NOT NULL,
        risk_score numeric(4,3) NOT NULL,
        policy_version text NOT NULL,
        rationale jsonb NOT NULL,
        actor text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (case_id, run_id)
      );
      CREATE INDEX proposals_case ON proposals (case_id, created_at DESC);`);
  }

  async down(q: QueryRunner) {
    await q.query(`
      DROP TABLE IF EXISTS proposals; DROP TABLE IF EXISTS refund_policies; DROP TABLE IF EXISTS decisions;
      DROP TABLE IF EXISTS evidence; DROP TABLE IF EXISTS return_items; DROP TABLE IF EXISTS return_requests;`);
  }
}
