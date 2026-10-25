import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CategoryApprovalQueueSchema,
  type DecisionInput,
  KycQueueSchema,
  SellerAccountSchema,
  type SellerApplicationInput,
  SellerCategoriesSchema,
  TOPICS,
} from '@ac/contracts';
import { OutboxService } from '@ac/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { CatalogCategories } from './catalog-categories.js';
import { KeycloakAdmin } from './keycloak-admin.js';
import { kycChecks } from './kyc-checks.js';

const n = (v: unknown) => Number(v ?? 0);
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
/** seller may edit/submit only in these states */
const EDITABLE = ['DRAFT', 'ACTION_REQUIRED'];
const KYC_DECISION = { APPROVE: 'VERIFIED', REJECT: 'REJECTED', REQUEST_CHANGES: 'ACTION_REQUIRED' } as const;

@Injectable()
export class SellersService {
  private readonly log = new Logger(SellersService.name);

  constructor(
    private readonly db: DataSource,
    private readonly outbox: OutboxService,
    private readonly keycloak: KeycloakAdmin,
    private readonly catalog: CatalogCategories,
  ) {}

  // ------------------------------------------------------------ seller side
  async me(sellerId: string) {
    const [row] = await this.db.query(`SELECT * FROM seller_accounts WHERE seller_id = $1`, [sellerId]);
    if (!row) throw new NotFoundException('No seller account yet — start your application');
    return this.view(row);
  }

  /** PUT /sellers/me — create or update the draft (also after ACTION_REQUIRED). */
  async saveDraft(sellerId: string, a: SellerApplicationInput) {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.query(`SELECT kyc_status FROM seller_accounts WHERE seller_id = $1 FOR UPDATE`, [sellerId]);
      if (cur && !EDITABLE.includes(cur.kyc_status)) throw new ConflictException(`Application is ${cur.kyc_status.toLowerCase().replace('_', ' ')} and can no longer be edited`);
      const { checks } = kycChecks(a, await this.duplicates(tx, sellerId, a));
      const vals = [sellerId, a.displayName, a.legalName, a.businessType, a.gstin, a.pan, JSON.stringify(a.address), a.contactEmail, a.contactPhone, JSON.stringify(a.bank), JSON.stringify(checks)];
      if (!cur) {
        await tx.query(
          `INSERT INTO seller_accounts (seller_id, display_name, legal_name, business_type, gstin, pan, address, contact_email, contact_phone, bank, checks, kyc_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT')`,
          vals,
        );
        await this.history(tx, sellerId, null, 'DRAFT', sellerId, null);
      } else {
        await tx.query(
          `UPDATE seller_accounts SET display_name = $2, legal_name = $3, business_type = $4, gstin = $5, pan = $6, address = $7, contact_email = $8,
                  contact_phone = $9, bank = $10, checks = $11, version = version + 1, updated_at = now() WHERE seller_id = $1`,
          vals,
        );
      }
      const [row] = await tx.query(`SELECT * FROM seller_accounts WHERE seller_id = $1`, [sellerId]);
      return this.view(row);
    });
  }

  /** POST /sellers/me/submit — DRAFT | ACTION_REQUIRED → SUBMITTED; blocked while identity checks fail. */
  async submit(sellerId: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.query(`SELECT * FROM seller_accounts WHERE seller_id = $1 FOR UPDATE`, [sellerId]);
      if (!row) throw new NotFoundException('Save your application first');
      if (!EDITABLE.includes(row.kyc_status)) throw new ConflictException(`Application is already ${row.kyc_status.toLowerCase().replace('_', ' ')}`);
      const input = this.asInput(row);
      const { checks, blocking } = kycChecks(input, await this.duplicates(tx, sellerId, input));
      if (blocking.length) throw new UnprocessableEntityException({ message: 'Fix these before submitting', checks: blocking });
      await tx.query(
        `UPDATE seller_accounts SET kyc_status = 'SUBMITTED', checks = $2, submitted_at = now(), version = version + 1, updated_at = now() WHERE seller_id = $1`,
        [sellerId, JSON.stringify(checks)],
      );
      await this.history(tx, sellerId, row.kyc_status, 'SUBMITTED', sellerId, null);
      const [after] = await tx.query(`SELECT * FROM seller_accounts WHERE seller_id = $1`, [sellerId]);
      return this.view(after);
    });
  }

  async categories(sellerId: string) {
    await this.requireVerified(sellerId);
    const cats = await this.catalog.list();
    const rows = await this.db.query(`SELECT category, status, license_number, note FROM category_approvals WHERE seller_id = $1`, [sellerId]);
    const by = new Map(rows.map((r: any) => [r.category, r]));
    return SellerCategoriesSchema.parse({
      categories: cats.map((c) => {
        const a: any = by.get(c.id);
        return { category: c.id, name: c.name, gated: c.gated, requirement: c.requirement, status: !c.gated ? 'NOT_REQUIRED' : a ? a.status : 'NOT_REQUESTED', licenseNumber: a?.license_number ?? null, note: a?.note ?? null };
      }),
    });
  }

  /** POST /sellers/me/categories/:category — request approval for a gated category (again after a rejection). */
  async requestCategory(sellerId: string, category: string, licenseNumber: string) {
    await this.requireVerified(sellerId);
    const cat = (await this.catalog.list()).find((c) => c.id === category);
    if (!cat) throw new NotFoundException(`Unknown category ${category}`);
    if (!cat.gated) throw new BadRequestException(`${cat.name} is open to all verified sellers — no approval needed`);
    const [row] = await this.db.query(
      `INSERT INTO category_approvals (id, seller_id, category, license_number, status) VALUES ($1, $2, $3, $4, 'PENDING')
       ON CONFLICT (seller_id, category) DO UPDATE SET license_number = EXCLUDED.license_number, status = 'PENDING', note = NULL,
              requested_at = now(), decided_at = NULL, decided_by = NULL, version = category_approvals.version + 1
        WHERE category_approvals.status = 'REJECTED'
       RETURNING id`,
      [randomUUID(), sellerId, category, licenseNumber],
    );
    if (!row) throw new ConflictException(`A request for ${cat.name} is already pending or approved`);
    return this.categories(sellerId);
  }

  // ------------------------------------------------------------ compliance
  async kycQueue() {
    const [k] = await this.db.query(
      `SELECT count(*) FILTER (WHERE kyc_status = 'SUBMITTED') AS submitted,
              count(*) FILTER (WHERE kyc_status = 'ACTION_REQUIRED') AS action,
              count(*) FILTER (WHERE kyc_status = 'VERIFIED' AND decided_at > now() - interval '30 days') AS verified,
              count(*) FILTER (WHERE kyc_status = 'REJECTED' AND decided_at > now() - interval '30 days') AS rejected
         FROM seller_accounts`,
    );
    const rows = await this.db.query(
      `SELECT * FROM seller_accounts WHERE kyc_status IN ('SUBMITTED', 'ACTION_REQUIRED')
        ORDER BY (kyc_status = 'SUBMITTED') DESC, submitted_at ASC NULLS LAST LIMIT 50`,
    );
    return KycQueueSchema.parse({
      kpis: { submitted: n(k.submitted), actionRequired: n(k.action), verified30d: n(k.verified), rejected30d: n(k.rejected) },
      items: rows.map((r: any) => this.view(r)),
    });
  }

  /** POST /kyc/:sellerId/decision — SUBMITTED → VERIFIED | REJECTED | ACTION_REQUIRED (version-checked). */
  async decideKyc(sellerId: string, d: DecisionInput, actor: string) {
    const to = KYC_DECISION[d.decision];
    if (d.decision !== 'APPROVE' && !d.note) throw new BadRequestException('A note for the seller is required when rejecting or requesting changes');
    const row = await this.db.transaction(async (tx) => {
      const [[updated]] = await tx.query( // UPDATE … RETURNING → [rows, rowCount]
        `UPDATE seller_accounts SET kyc_status = $3, decided_at = now(), decided_by = $4, decision_note = $5, version = version + 1, updated_at = now()
          WHERE seller_id = $1 AND version = $2 AND kyc_status = 'SUBMITTED' RETURNING *`,
        [sellerId, d.version, to, actor, d.note || null],
      );
      if (!updated) throw await this.conflict(tx, `SELECT kyc_status AS status, version FROM seller_accounts WHERE seller_id = $1`, sellerId, 'SUBMITTED');
      await this.history(tx, sellerId, 'SUBMITTED', to, actor, d.note || null);
      if (to === 'VERIFIED') {
        await this.outbox.enqueue(tx, {
          topic: TOPICS.user,
          type: 'user.seller_verified.v1',
          aggregateId: sellerId,
          subject: sellerId,
          data: { sellerId, displayName: updated.display_name, businessType: updated.business_type },
        });
      }
      return updated;
    });
    if (to === 'VERIFIED' && (await this.keycloak.grantRealmRole(sellerId, 'seller'))) {
      await this.db.query(`UPDATE seller_accounts SET role_granted_at = now() WHERE seller_id = $1`, [sellerId]);
    }
    return this.view(row);
  }

  // ------------------------------------------------------------ category team
  async categoryQueue() {
    const cats = await this.catalog.list().catch(() => []);
    const req = new Map(cats.map((c) => [c.id, c.requirement]));
    const rows = await this.db.query(
      `SELECT a.*, s.display_name FROM category_approvals a JOIN seller_accounts s USING (seller_id)
        WHERE a.status = 'PENDING' ORDER BY a.requested_at ASC LIMIT 50`,
    );
    return CategoryApprovalQueueSchema.parse({
      items: rows.map((r: any) => ({
        approvalId: r.id, sellerId: r.seller_id, sellerName: r.display_name, category: r.category,
        requirement: req.get(r.category) ?? 'Category licence', licenseNumber: r.license_number, requestedAt: iso(r.requested_at), version: r.version,
      })),
    });
  }

  async decideCategory(id: string, d: DecisionInput, actor: string) {
    if (d.decision !== 'APPROVE' && !d.note) throw new BadRequestException('A note for the seller is required when rejecting');
    const to = d.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.db.transaction(async (tx) => {
      const [[updated]] = await tx.query( // UPDATE … RETURNING → [rows, rowCount]
        `UPDATE category_approvals SET status = $3, note = $4, decided_at = now(), decided_by = $5, version = version + 1
          WHERE id = $1 AND version = $2 AND status = 'PENDING' RETURNING seller_id, category`,
        [id, d.version, to, d.note || (to === 'APPROVED' ? 'Licence verified' : null), actor],
      );
      if (!updated) throw await this.conflict(tx, `SELECT status, version FROM category_approvals WHERE id = $1`, id, 'PENDING');
      if (to === 'APPROVED') {
        await this.outbox.enqueue(tx, {
          topic: TOPICS.user,
          type: 'user.category_approved.v1',
          aggregateId: updated.seller_id,
          data: { sellerId: updated.seller_id, category: updated.category },
        });
      }
    });
    return this.categoryQueue();
  }

  // ------------------------------------------------------------ helpers
  private async requireVerified(sellerId: string) {
    const [row] = await this.db.query(`SELECT kyc_status FROM seller_accounts WHERE seller_id = $1`, [sellerId]);
    if (row?.kyc_status !== 'VERIFIED') throw new ConflictException('Complete seller verification (KYC) first');
  }

  private async duplicates(tx: EntityManager, sellerId: string, a: { gstin: string; pan: string }) {
    const [d] = await tx.query(
      `SELECT count(*) FILTER (WHERE gstin = $2) AS g, count(*) FILTER (WHERE pan = $3) AS p FROM seller_accounts WHERE seller_id <> $1`,
      [sellerId, a.gstin, a.pan],
    );
    return { gstin: n(d.g), pan: n(d.p) };
  }

  private async conflict(tx: EntityManager, sql: string, id: string, expected: string) {
    const [cur] = await tx.query(sql, [id]);
    if (!cur) return new NotFoundException('Not found');
    if (cur.status !== expected) return new ConflictException(`Already decided (${cur.status})`);
    return new ConflictException(`Changed since you opened it (now version ${cur.version}) — reload and try again`);
  }

  private history(tx: EntityManager, sellerId: string, from: string | null, to: string, actor: string, note: string | null) {
    return tx.query(`INSERT INTO kyc_history (seller_id, from_status, to_status, actor, note) VALUES ($1, $2, $3, $4, $5)`, [sellerId, from, to, actor, note]);
  }

  private asInput(r: any): SellerApplicationInput {
    return {
      legalName: r.legal_name, displayName: r.display_name, businessType: r.business_type, gstin: r.gstin.trim(), pan: r.pan.trim(),
      address: r.address, contactEmail: r.contact_email, contactPhone: r.contact_phone, bank: r.bank,
    };
  }

  /** Response view: PAN masked, bank account reduced to its last 4 digits. */
  private view(r: any) {
    const pan = String(r.pan).trim();
    return SellerAccountSchema.parse({
      sellerId: r.seller_id, displayName: r.display_name, legalName: r.legal_name, businessType: r.business_type, gstin: String(r.gstin).trim(),
      panMasked: `${'•'.repeat(6)}${pan.slice(6)}`,
      address: r.address, contactEmail: r.contact_email,
      bank: { accountHolder: r.bank.accountHolder, ifsc: r.bank.ifsc, accountLast4: String(r.bank.accountNumber).slice(-4) },
      kycStatus: r.kyc_status, checks: r.checks, submittedAt: iso(r.submitted_at), decidedAt: iso(r.decided_at), decisionNote: r.decision_note, version: r.version,
    });
  }
}
