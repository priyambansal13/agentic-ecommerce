import { Injectable } from '@nestjs/common';
import { FraudDashboardSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';

const n = (v: unknown) => Number(v ?? 0);
const BUCKETS: [string, number, number][] = [
  ['0.30–0.50', 0.3, 0.5],
  ['0.50–0.70', 0.5, 0.7],
  ['0.70–0.85', 0.7, 0.85],
  ['0.85–1.00', 0.85, 1.0001],
];

@Injectable()
export class DashboardService {
  constructor(private readonly db: DataSource) {}

  async summary() {
    const [k] = await this.db.query(
      `SELECT count(*) FILTER (WHERE status = 'OPEN') AS open,
              count(*) FILTER (WHERE status = 'INVESTIGATING') AS investigating,
              count(*) FILTER (WHERE status = 'CONFIRMED_FRAUD' AND raised_at > now() - interval '30 days') AS confirmed,
              count(*) FILTER (WHERE status = 'FALSE_POSITIVE' AND raised_at > now() - interval '30 days') AS fp
         FROM alerts`,
    );
    const buckets = await Promise.all(
      BUCKETS.map(async ([bucket, lo, hi]) => {
        const [r] = await this.db.query(`SELECT count(*) AS c FROM alerts WHERE score >= $1 AND score < $2 AND raised_at > now() - interval '30 days'`, [lo, hi]);
        return { bucket, count: n(r.c) };
      }),
    );
    const rules = await this.db.query(
      `SELECT rule, count(*) AS c FROM alerts, jsonb_array_elements_text(rules) AS rule
        WHERE raised_at > now() - interval '30 days' GROUP BY rule ORDER BY c DESC, rule LIMIT 6`,
    );
    const recent = await this.db.query(`SELECT id, subject_type, subject, score, decision, status, rules, raised_at FROM alerts ORDER BY raised_at DESC LIMIT 15`);
    return FraudDashboardSchema.parse({
      kpis: { open: n(k.open), investigating: n(k.investigating), confirmed30d: n(k.confirmed), falsePositive30d: n(k.fp) },
      scoreBuckets: buckets,
      topRules: rules.map((r: any) => ({ rule: r.rule, count: n(r.c) })),
      recentAlerts: recent.map((r: any) => ({
        alertId: r.id,
        subject: `${r.subject_type.toLowerCase()} ${r.subject}`,
        score: n(r.score),
        decision: r.decision,
        status: r.status,
        rules: r.rules,
        raisedAt: new Date(r.raised_at).toISOString(),
      })),
    });
  }
}
