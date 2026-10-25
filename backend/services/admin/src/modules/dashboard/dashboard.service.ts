import { Injectable } from '@nestjs/common';
import { AdminOverviewDashboardSchema, ModerationDashboardSchema, PlatformHealthSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';

const n = (v: unknown) => Number(v ?? 0);
const VERDICTS = ['APPROVE', 'NEEDS_REVIEW', 'REJECT'] as const;

@Injectable()
export class DashboardService {
  constructor(private readonly db: DataSource) {}

  async moderation() {
    const [k] = await this.db.query(
      `SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending,
              count(*) FILTER (WHERE decided_by = 'agent' AND decided_at > now() - interval '7 days') AS auto,
              count(*) FILTER (WHERE decided_by = 'human' AND decided_at > now() - interval '7 days') AS human
         FROM moderation_items`,
    );
    const verdicts = await this.db.query(
      `SELECT agent_verdict AS v, count(*) AS c FROM moderation_items WHERE created_at > now() - interval '7 days' GROUP BY agent_verdict`,
    );
    const queue = await this.db.query(
      `SELECT id, title, seller_name, agent_verdict, confidence, reasons, extract(epoch FROM now() - created_at) / 3600 AS age_h, version, product_id, brand, category
         FROM moderation_items WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 20`,
    );
    const auto = n(k.auto);
    const human = n(k.human);
    return ModerationDashboardSchema.parse({
      kpis: { pending: n(k.pending), autoApproved7d: auto, humanDecided7d: human, autoApprovalRate7d: auto + human ? Math.round((auto / (auto + human)) * 1000) / 1000 : 0 },
      verdicts7d: VERDICTS.map((v) => ({ verdict: v, count: n(verdicts.find((r: any) => r.v === v)?.c) })),
      queue: queue.map((r: any) => ({
        itemId: r.id,
        title: r.title,
        sellerName: r.seller_name,
        agentVerdict: r.agent_verdict,
        confidence: n(r.confidence),
        reasons: r.reasons,
        ageHours: Math.round(n(r.age_h) * 10) / 10,
        version: r.version,
        productId: r.product_id,
        brand: r.brand ?? undefined,
        category: r.category ?? undefined,
      })),
    });
  }

  async overview() {
    const [k] = await this.db.query(
      `SELECT (SELECT count(*) FROM disputes WHERE status <> 'RESOLVED') AS disputes,
              (SELECT count(*) FROM moderation_items WHERE status = 'PENDING') AS moderation,
              (SELECT count(*) FROM seller_sanctions) AS sanctions`,
    );
    return AdminOverviewDashboardSchema.parse({ openDisputes: n(k.disputes), pendingModeration: n(k.moderation), sanctionedSellers: n(k.sanctions) });
  }

  /** Probes every service's /health THROUGH KONG (the same path users take), 2 s timeout each, in parallel. */
  async platformHealth() {
    const kong = process.env.KONG_URL ?? 'http://localhost:58000';
    const names = (process.env.PLATFORM_SERVICES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const services = await Promise.all(
      names.map(async (name) => {
        const started = Date.now();
        try {
          const res = await fetch(`${kong}/api/${name}/health`, { signal: AbortSignal.timeout(2000) });
          const body = (await res.json().catch(() => ({}))) as { status?: string; checks?: { db?: string } };
          const db = body.checks?.db === 'up' ? 'up' : body.checks?.db === 'down' ? 'down' : 'none';
          const status = res.ok && body.status === 'ok' ? 'ok' : res.ok ? 'degraded' : 'down';
          return { name, status, db, latencyMs: Date.now() - started };
        } catch {
          return { name, status: 'down', db: 'none', latencyMs: Date.now() - started };
        }
      }),
    );
    return PlatformHealthSchema.parse({ checkedAt: new Date().toISOString(), services });
  }
}
