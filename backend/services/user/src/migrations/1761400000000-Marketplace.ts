import type { MigrationInterface, QueryRunner } from 'typeorm';

/** user service: seller accounts + KYC, KYC history, gated-category approvals (own database ac_users only). */
export class Marketplace1761400000000 implements MigrationInterface {
  name = 'Marketplace1761400000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE seller_accounts (
        seller_id uuid PRIMARY KEY,
        display_name text NOT NULL,
        legal_name text NOT NULL,
        business_type text NOT NULL CHECK (business_type IN ('MANUFACTURER','BRAND_OWNER','DISTRIBUTOR','RETAILER')),
        gstin char(15) NOT NULL,
        pan char(10) NOT NULL,
        address jsonb NOT NULL,
        contact_email text NOT NULL,
        contact_phone text NOT NULL,
        bank jsonb NOT NULL,
        kyc_status text NOT NULL CHECK (kyc_status IN ('DRAFT','SUBMITTED','ACTION_REQUIRED','VERIFIED','REJECTED')),
        checks jsonb NOT NULL DEFAULT '[]',
        submitted_at timestamptz,
        decided_at timestamptz,
        decided_by text,
        decision_note text,
        role_granted_at timestamptz,
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX seller_accounts_status ON seller_accounts (kyc_status, submitted_at);
      CREATE INDEX seller_accounts_gstin ON seller_accounts (gstin);
      CREATE TABLE kyc_history (
        id bigserial PRIMARY KEY,
        seller_id uuid NOT NULL REFERENCES seller_accounts (seller_id) ON DELETE CASCADE,
        from_status text,
        to_status text NOT NULL,
        actor text NOT NULL,
        note text,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE category_approvals (
        id uuid PRIMARY KEY,
        seller_id uuid NOT NULL REFERENCES seller_accounts (seller_id) ON DELETE CASCADE,
        category text NOT NULL,
        license_number text NOT NULL,
        status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
        note text,
        requested_at timestamptz NOT NULL DEFAULT now(),
        decided_at timestamptz,
        decided_by text,
        version int NOT NULL DEFAULT 1,
        UNIQUE (seller_id, category)
      );
      CREATE INDEX category_approvals_status ON category_approvals (status, requested_at);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS category_approvals; DROP TABLE IF EXISTS kyc_history; DROP TABLE IF EXISTS seller_accounts;`);
  }
}
