import type { MigrationInterface, QueryRunner } from 'typeorm';

/** admin service: moderation items become decidable (version for optimistic concurrency, decision note, listing context). */
export class ModerationDecisions1761400000000 implements MigrationInterface {
  name = 'ModerationDecisions1761400000000';

  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE moderation_items
        ADD COLUMN version int NOT NULL DEFAULT 1,
        ADD COLUMN brand text,
        ADD COLUMN category text,
        ADD COLUMN decision_note text,
        ADD COLUMN decided_by_user text;
      CREATE INDEX moderation_items_product ON moderation_items (product_id);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP INDEX IF EXISTS moderation_items_product;
      ALTER TABLE moderation_items DROP COLUMN IF EXISTS version, DROP COLUMN IF EXISTS brand, DROP COLUMN IF EXISTS category,
        DROP COLUMN IF EXISTS decision_note, DROP COLUMN IF EXISTS decided_by_user;`);
  }
}
