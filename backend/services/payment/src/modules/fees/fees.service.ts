import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { FeeBreakdownSchema, FeeScheduleSchema, FeeSchedulesSchema, SellerFeesSchema } from '@ac/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { type FeeRule, type FeeScheduleTerms, lineFees, validateTerms } from './fee-math.js';

const CURRENCY = 'INR';
const n = (v: unknown) => Number(v ?? 0);
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);

export interface Actor { id: string; name: string }
export interface ScheduleUpdate { paymentFeeBps: number; gstBps: number; rules: FeeRule[]; note?: string; rowVersion: number }

/**
 * Fee schedules with maker-checker: finance drafts and submits; a DIFFERENT finance user or an admin approves.
 * Approving activates the new version (effective now) and retires the previous one, in one transaction.
 */
@Injectable()
export class FeesService {
  constructor(private readonly db: DataSource) {}

  async active(): Promise<FeeScheduleTerms & { row: any }> {
    const [row] = await this.db.query(`SELECT * FROM fee_schedules WHERE status = 'ACTIVE'`);
    if (!row) throw new ServiceUnavailableException('No active fee schedule');
    return { version: row.version, paymentFeeBps: row.payment_fee_bps, gstBps: row.gst_bps, rules: row.rules, row };
  }

  async activeView() {
    return this.view((await this.active()).row);
  }

  async list() {
    const rows = await this.db.query(`SELECT * FROM fee_schedules ORDER BY version DESC LIMIT 50`);
    return FeeSchedulesSchema.parse({ items: rows.map((r: any) => this.view(r)) });
  }

  /** New DRAFT copied from the ACTIVE schedule — only one open (draft or pending) schedule at a time. */
  async createDraft(by: Actor) {
    const cur = await this.active();
    try {
      const [row] = await this.db.query(
        `INSERT INTO fee_schedules (id, version, status, payment_fee_bps, gst_bps, rules, note, created_by, created_by_name)
         VALUES ($1, (SELECT max(version) + 1 FROM fee_schedules), 'DRAFT', $2, $3, $4, NULL, $5, $6) RETURNING *`,
        [randomUUID(), cur.paymentFeeBps, cur.gstBps, JSON.stringify(cur.rules), by.id, by.name],
      );
      return this.view(row);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('A draft or pending schedule already exists — continue with it');
      throw e;
    }
  }

  async update(id: string, u: ScheduleUpdate) {
    const problems = validateTerms(u);
    if (problems.length) throw new BadRequestException({ message: 'Invalid fee schedule', problems });
    const [[row]] = await this.db.query( // UPDATE … RETURNING → [rows, rowCount]
      `UPDATE fee_schedules SET payment_fee_bps = $3, gst_bps = $4, rules = $5, note = $6, row_version = row_version + 1
        WHERE id = $1 AND status = 'DRAFT' AND row_version = $2 RETURNING *`,
      [id, u.rowVersion, u.paymentFeeBps, u.gstBps, JSON.stringify(u.rules), u.note ?? null],
    );
    if (!row) throw await this.conflict(id, 'DRAFT');
    return this.view(row);
  }

  async submit(id: string, by: Actor) {
    const [cur] = await this.db.query(`SELECT rules FROM fee_schedules WHERE id = $1`, [id]);
    if (cur && validateTerms({ rules: cur.rules }).length) throw new BadRequestException('Fix the schedule before submitting');
    const [[row]] = await this.db.query( // UPDATE … RETURNING → [rows, rowCount]
      `UPDATE fee_schedules SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_name = $3, row_version = row_version + 1
        WHERE id = $1 AND status = 'DRAFT' RETURNING *`,
      [id, by.id, by.name],
    );
    if (!row) throw await this.conflict(id, 'DRAFT');
    return this.view(row);
  }

  /** Checker step. Never the maker: whoever created or submitted the draft cannot approve or reject it. */
  async decide(id: string, approve: boolean, by: Actor, note?: string) {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.query(`SELECT * FROM fee_schedules WHERE id = $1 FOR UPDATE`, [id]);
      if (!cur) throw new NotFoundException('Unknown fee schedule');
      if (cur.status !== 'PENDING_APPROVAL') throw new ConflictException(`Schedule v${cur.version} is ${cur.status}, not pending approval`);
      if (cur.created_by === by.id || cur.submitted_by === by.id) {
        throw new ForbiddenException('Maker-checker: you created or submitted this schedule, so a different finance user or an admin must approve it');
      }
      if (approve) {
        await tx.query(`UPDATE fee_schedules SET status = 'RETIRED', row_version = row_version + 1 WHERE status = 'ACTIVE'`);
      }
      const [[row]] = await tx.query( // UPDATE … RETURNING → [rows, rowCount]
        `UPDATE fee_schedules SET status = $2, approved_by = $3, approved_by_name = $4, approved_at = now(),
                effective_from = CASE WHEN $2 = 'ACTIVE' THEN now() ELSE NULL END,
                note = coalesce($5, note), row_version = row_version + 1
          WHERE id = $1 RETURNING *`,
        [id, approve ? 'ACTIVE' : 'REJECTED', by.id, by.name, note ?? null],
      );
      return this.view(row);
    });
  }

  async preview(category: string, priceMinor: number, quantity: number) {
    const s = await this.active();
    const f = lineFees(s, category, priceMinor, quantity);
    return FeeBreakdownSchema.parse({ currency: CURRENCY, scheduleVersion: s.version, ...f, effectiveRate: f.saleMinor ? Math.round((f.totalFeesMinor / f.saleMinor) * 10_000) / 10_000 : 0 });
  }

  async sellerFees(sellerId: string) {
    const [t] = await this.db.query(
      `SELECT coalesce(sum(sale_minor), 0) AS sale, coalesce(sum(referral_minor), 0) AS referral, coalesce(sum(closing_minor), 0) AS closing,
              coalesce(sum(payment_minor), 0) AS payment, coalesce(sum(gst_minor), 0) AS gst
         FROM order_fees WHERE seller_id = $1 AND reversed_at IS NULL AND created_at > now() - interval '30 days'`,
      [sellerId],
    );
    const by = await this.db.query(
      `SELECT category, sum(sale_minor) AS sale, sum(referral_minor + closing_minor + payment_minor + gst_minor) AS fees
         FROM order_fees WHERE seller_id = $1 AND reversed_at IS NULL AND created_at > now() - interval '30 days' GROUP BY category ORDER BY sum(sale_minor) DESC`,
      [sellerId],
    );
    const total = n(t.referral) + n(t.closing) + n(t.payment) + n(t.gst);
    return SellerFeesSchema.parse({
      currency: CURRENCY,
      totals: { salesMinor: n(t.sale), referralMinor: n(t.referral), closingMinor: n(t.closing), paymentMinor: n(t.payment), gstMinor: n(t.gst), totalFeesMinor: total },
      byCategory: by.map((r: any) => ({ category: r.category, salesMinor: n(r.sale), feesMinor: n(r.fees) })),
    });
  }

  /** Platform fee revenue over 30 days (finance dashboard). */
  async platformFees30d() {
    const [t] = await this.db.query(
      `SELECT coalesce(sum(referral_minor), 0) AS referral, coalesce(sum(closing_minor), 0) AS closing, coalesce(sum(payment_minor), 0) AS payment, coalesce(sum(gst_minor), 0) AS gst
         FROM order_fees WHERE reversed_at IS NULL AND created_at > now() - interval '30 days'`,
    );
    return { referralMinor: n(t.referral), closingMinor: n(t.closing), paymentMinor: n(t.payment), gstMinor: n(t.gst), totalMinor: n(t.referral) + n(t.closing) + n(t.payment) + n(t.gst) };
  }

  private async conflict(id: string, expected: string) {
    const [cur] = await this.db.query(`SELECT status, version, row_version FROM fee_schedules WHERE id = $1`, [id]);
    if (!cur) return new NotFoundException('Unknown fee schedule');
    if (cur.status !== expected) return new ConflictException(`Schedule v${cur.version} is ${cur.status} — only a ${expected} can be changed`);
    return new ConflictException(`Schedule changed since you opened it (now revision ${cur.row_version}) — reload`);
  }

  private view(r: any) {
    return FeeScheduleSchema.parse({
      scheduleId: r.id, version: r.version, status: r.status, effectiveFrom: iso(r.effective_from), paymentFeeBps: r.payment_fee_bps, gstBps: r.gst_bps,
      rules: r.rules, note: r.note, createdBy: r.created_by_name, submittedBy: r.submitted_by_name, approvedBy: r.approved_by_name,
      createdAt: iso(r.created_at), approvedAt: iso(r.approved_at), rowVersion: r.row_version,
    });
  }
}
