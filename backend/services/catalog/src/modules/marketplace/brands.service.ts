import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { type BrandApplicationInput, BrandApplicationSchema, BrandQueueSchema, type Check, type DecisionInput, MyBrandsSchema, TOPICS } from '@ac/contracts';
import { OutboxService } from '@ac/nest-common';
import { emitOfferUpdates } from './offers.service.js';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { eligibilityOf } from './eligibility.js';

const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);

@Injectable()
export class BrandsService {
  constructor(private readonly db: DataSource, private readonly outbox: OutboxService) {}

  /** POST /brands/applications — verified sellers; blocked when the name is taken or already under review. */
  async apply(sellerId: string, a: BrandApplicationInput) {
    const e = await eligibilityOf(this.db, sellerId);
    const [taken] = await this.db.query(`SELECT name FROM brands WHERE lower(name) = lower($1)`, [a.brandName]);
    const [pending] = await this.db.query(`SELECT seller_id FROM brand_applications WHERE lower(brand_name) = lower($1) AND status = 'SUBMITTED'`, [a.brandName]);
    const checks: Check[] = [
      { check: 'seller_verified', passed: e.verified, detail: e.verified ? 'Seller KYC verified' : 'Complete seller verification (KYC) first' },
      { check: 'name_available', passed: !taken && !pending, detail: taken ? `"${taken.name}" is already registered` : pending ? 'Another application for this name is under review' : 'Brand name is not registered' },
      { check: 'trademark_format', passed: true, detail: `Trademark no. ${a.trademarkNumber} (${a.trademarkStatus.toLowerCase()})` },
      { check: 'trademark_registered', passed: a.trademarkStatus === 'REGISTERED', detail: a.trademarkStatus === 'REGISTERED' ? 'Registered trademark' : 'Trademark application pending — brand team verifies on IP India' },
      { check: 'evidence', passed: !!a.evidenceUrl, detail: a.evidenceUrl ? 'Evidence link provided' : 'No evidence link — brand team may ask for the certificate' },
    ];
    const blocking = checks.filter((c) => !c.passed && ['seller_verified', 'name_available'].includes(c.check));
    if (blocking.length) throw new UnprocessableEntityException({ message: blocking.map((c) => c.detail).join('; '), checks: blocking });
    const [row] = await this.db.query(
      `INSERT INTO brand_applications (id, seller_id, seller_name, brand_name, trademark_number, trademark_status, relationship, evidence_url, restrict_resellers, status, checks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SUBMITTED', $10) RETURNING *`,
      [randomUUID(), sellerId, e.displayName, a.brandName, a.trademarkNumber, a.trademarkStatus, a.relationship, a.evidenceUrl ?? null, a.restrictResellers, JSON.stringify(checks)],
    );
    return this.application(row);
  }

  async mine(sellerId: string) {
    const owned = await this.db.query(`SELECT * FROM brands WHERE owner_seller_id = $1 ORDER BY name`, [sellerId]);
    const resellers = owned.length
      ? await this.db.query(`SELECT * FROM brand_resellers WHERE brand_id = ANY($1::uuid[]) ORDER BY seller_name`, [owned.map((b: any) => b.id)])
      : [];
    const authorized = await this.db.query(`SELECT b.* FROM brand_resellers r JOIN brands b ON b.id = r.brand_id WHERE r.seller_id = $1 ORDER BY b.name`, [sellerId]);
    const apps = await this.db.query(`SELECT * FROM brand_applications WHERE seller_id = $1 ORDER BY submitted_at DESC`, [sellerId]);
    return MyBrandsSchema.parse({
      owned: owned.map((b: any) => ({
        ...this.brand(b),
        resellers: resellers.filter((r: any) => r.brand_id === b.id).map((r: any) => ({ sellerId: r.seller_id, sellerName: r.seller_name, authorizedAt: iso(r.authorized_at) })),
      })),
      authorizedFor: authorized.map((b: any) => this.brand(b)),
      applications: apps.map((r: any) => this.application(r)),
    });
  }

  /** PUT/DELETE /brands/:brandId/resellers/:sellerId — only the brand owner. */
  async setReseller(owner: string, brandId: string, sellerId: string, authorize: boolean) {
    const [b] = await this.db.query(`SELECT owner_seller_id FROM brands WHERE id = $1`, [brandId]);
    if (!b) throw new NotFoundException('Unknown brand');
    if (b.owner_seller_id !== owner) throw new ForbiddenException('Only the brand owner can manage authorized resellers');
    if (sellerId === owner) throw new BadRequestException('The owner is always allowed to sell its brand');
    if (authorize) {
      const [s] = await this.db.query(`SELECT display_name FROM seller_eligibility WHERE seller_id = $1 AND verified`, [sellerId]);
      if (!s) throw new NotFoundException('No verified seller with that id');
      await this.db.query(`INSERT INTO brand_resellers (brand_id, seller_id, seller_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [brandId, sellerId, s.display_name]);
    } else {
      // revoking also suppresses the reseller's live offers on this brand's products
      await this.db.transaction(async (tx) => {
        await tx.query(`DELETE FROM brand_resellers WHERE brand_id = $1 AND seller_id = $2`, [brandId, sellerId]);
        const [rows] = await tx.query(
          `UPDATE offers o SET status = 'INACTIVE' FROM products p, brands b
            WHERE o.product_id = p.id AND lower(p.brand) = lower(b.name) AND b.id = $1 AND o.seller_id = $2 AND o.status = 'ACTIVE'
            RETURNING o.id, o.product_id, o.seller_id, o.price_minor, o.status`,
          [brandId, sellerId],
        );
        await emitOfferUpdates(this.outbox, tx, rows);
      });
    }
    return this.mine(owner);
  }

  async queue() {
    const rows = await this.db.query(`SELECT * FROM brand_applications WHERE status = 'SUBMITTED' ORDER BY submitted_at ASC LIMIT 50`);
    return BrandQueueSchema.parse({ items: rows.map((r: any) => this.application(r)) });
  }

  /** POST /brand-applications/:id/decision — brand team. APPROVE registers the brand to the applicant. */
  async decide(id: string, d: DecisionInput, actor: string) {
    if (d.decision !== 'APPROVE' && !d.note) throw new BadRequestException('A note for the seller is required when rejecting');
    const status = d.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const row = await this.db.transaction(async (tx) => {
      const [[app]] = await tx.query( // UPDATE … RETURNING → [rows, rowCount]
        `UPDATE brand_applications SET status = $3, decided_at = now(), decided_by = $4, note = $5, version = version + 1
          WHERE id = $1 AND version = $2 AND status = 'SUBMITTED' RETURNING *`,
        [id, d.version, status, actor, d.note || (status === 'APPROVED' ? 'Trademark verified' : null)],
      );
      if (!app) {
        const [cur] = await tx.query(`SELECT status, version FROM brand_applications WHERE id = $1`, [id]);
        if (!cur) throw new NotFoundException('Unknown application');
        throw new ConflictException(cur.status !== 'SUBMITTED' ? `Already decided (${cur.status})` : `Changed since you opened it (now version ${cur.version}) — reload`);
      }
      if (status === 'APPROVED') {
        const brandId = randomUUID();
        const [dup] = await tx.query(`SELECT 1 FROM brands WHERE lower(name) = lower($1)`, [app.brand_name]);
        if (dup) throw new ConflictException(`"${app.brand_name}" was registered in the meantime — reject this application`);
        await tx.query(
          `INSERT INTO brands (id, name, owner_seller_id, owner_name, restricted, trademark_number) VALUES ($1, $2, $3, $4, $5, $6)`,
          [brandId, app.brand_name, app.seller_id, app.seller_name, app.restrict_resellers, app.trademark_number],
        );
        await this.outbox.enqueue(tx, {
          topic: TOPICS.catalog,
          type: 'catalog.brand_approved.v1',
          aggregateId: brandId,
          data: { brandId, name: app.brand_name, ownerSellerId: app.seller_id, restricted: app.restrict_resellers },
        });
      }
      return app;
    });
    return this.application(row);
  }

  private brand(b: any) {
    return { brandId: b.id, name: b.name, ownerSellerId: b.owner_seller_id, ownerName: b.owner_name, restricted: b.restricted };
  }

  private application(r: any) {
    return BrandApplicationSchema.parse({
      applicationId: r.id, sellerId: r.seller_id, sellerName: r.seller_name, brandName: r.brand_name, trademarkNumber: r.trademark_number,
      trademarkStatus: r.trademark_status, relationship: r.relationship, evidenceUrl: r.evidence_url ?? undefined, restrictResellers: r.restrict_resellers,
      status: r.status, checks: r.checks, submittedAt: iso(r.submitted_at), decidedAt: iso(r.decided_at), note: r.note, version: r.version,
    });
  }
}
