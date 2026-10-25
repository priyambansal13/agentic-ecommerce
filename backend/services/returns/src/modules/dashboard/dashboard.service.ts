import { Injectable } from '@nestjs/common';
import { BuyerReturnsDashboardSchema, FinanceRefundsDashboardSchema, SupportDashboardSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';

const CURRENCY = 'INR';
const n = (v: unknown) => Number(v ?? 0);
const CASE_COLS = `id, order_no, reason, status, requested_minor, proposed_minor, risk_score, required_role, opened_at, agent_rationale,
                   extract(epoch FROM now() - opened_at) / 3600 AS age_h`;
const OPEN = `status NOT IN ('REFUNDED','REJECTED','CLOSED')`;

function toCase(r: any) {
  return {
    caseId: r.id,
    orderNo: r.order_no,
    reason: r.reason,
    // dashboards.ts RefundCaseStatus predates FAILED / APPEALED (0.7.0): show them as the nearest older status
    status: r.status === 'FAILED' ? 'REFUND_PENDING' : r.status === 'APPEALED' ? 'PENDING_HUMAN' : r.status,
    requestedMinor: n(r.requested_minor),
    proposedMinor: r.proposed_minor === null ? null : n(r.proposed_minor),
    riskScore: r.risk_score === null ? null : n(r.risk_score),
    requiredRole: r.required_role,
    openedAt: new Date(r.opened_at).toISOString(),
    ageHours: Math.round(n(r.age_h) * 10) / 10,
    agentRationale: r.agent_rationale,
  };
}

@Injectable()
export class DashboardService {
  constructor(private readonly db: DataSource) {}

  async buyer(buyerId: string) {
    const rows = await this.db.query(`SELECT ${CASE_COLS} FROM refund_cases WHERE buyer_id = $1 ORDER BY opened_at DESC LIMIT 20`, [buyerId]);
    const [{ open }] = await this.db.query(`SELECT count(*) AS open FROM refund_cases WHERE buyer_id = $1 AND ${OPEN}`, [buyerId]);
    return BuyerReturnsDashboardSchema.parse({ currency: CURRENCY, open: n(open), cases: rows.map(toCase) });
  }

  async support() {
    const queue = await this.db.query(
      `SELECT ${CASE_COLS} FROM refund_cases WHERE status = 'PENDING_HUMAN' AND required_role = 'support' ORDER BY opened_at ASC LIMIT 25`,
    );
    const [k] = await this.db.query(
      `SELECT count(*) FILTER (WHERE status = 'PENDING_HUMAN') AS pending,
              count(*) FILTER (WHERE decided_by = 'agent' AND opened_at > now() - interval '7 days') AS auto7,
              count(*) FILTER (WHERE status = 'REFUNDED' AND resolved_at > now() - interval '7 days') AS approved7,
              count(*) FILTER (WHERE status = 'REJECTED' AND resolved_at > now() - interval '7 days') AS rejected7,
              coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - opened_at) / 3600)
                       FILTER (WHERE resolved_at IS NOT NULL AND resolved_at > now() - interval '30 days'), 0) AS median_h
         FROM refund_cases`,
    );
    const byDay = await this.db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(c.id) AS v
         FROM generate_series((current_date - 13)::timestamp, current_date::timestamp, interval '1 day') d
         LEFT JOIN refund_cases c ON c.resolved_at >= d AND c.resolved_at < d + interval '1 day'
        GROUP BY d ORDER BY d`,
    );
    return SupportDashboardSchema.parse({
      currency: CURRENCY,
      kpis: { pendingHuman: n(k.pending), autoApproved7d: n(k.auto7), approved7d: n(k.approved7), rejected7d: n(k.rejected7), medianHoursToResolve: Math.round(n(k.median_h) * 10) / 10 },
      queue: queue.map(toCase),
      resolvedByDay: byDay.map((r: any) => ({ day: r.day, value: n(r.v) })),
    });
  }

  async finance() {
    const awaiting = await this.db.query(
      `SELECT ${CASE_COLS} FROM refund_cases WHERE status = 'PENDING_HUMAN' AND required_role = 'finance' ORDER BY opened_at ASC LIMIT 25`,
    );
    const [k] = await this.db.query(
      `SELECT coalesce(sum(approved_minor) FILTER (WHERE status = 'REFUNDED' AND resolved_at > now() - interval '30 days'), 0) AS refunded,
              count(*) FILTER (WHERE status IN ('AUTO_APPROVED','REFUND_PENDING','REFUNDED','APPROVED') AND opened_at > now() - interval '30 days') AS approved,
              count(*) FILTER (WHERE decided_by = 'agent' AND opened_at > now() - interval '30 days') AS auto
         FROM refund_cases`,
    );
    const approved = n(k.approved);
    return FinanceRefundsDashboardSchema.parse({
      currency: CURRENCY,
      awaitingFinance: awaiting.map(toCase),
      refunded30dMinor: n(k.refunded),
      autoApprovedShare30d: approved ? Math.round((n(k.auto) / approved) * 1000) / 1000 : 0,
    });
  }
}
