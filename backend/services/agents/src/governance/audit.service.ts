import { Injectable, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

const SENSITIVE = /(card|pan|cvv|phone|email|address|token|password|secret)/i;
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(v)]));
  return value;
}

export interface ToolAuditRow {
  runId: string;
  agentId: string;
  tool: string;
  tier: string;
  principalId?: string;
  actor: string;
  args: unknown;
  allowed: boolean;
  reasons: string[];
  resultStatus: 'OK' | 'DENIED' | 'ERROR';
}

/** Deterministic JSON for nested values (Postgres jsonb reorders object keys, so stored args must hash the same). */
function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeysDeep((v as Record<string, unknown>)[k])]));
  return v;
}

/**
 * THE canonical body that is hashed — used by record() and verifyChain(), so they can never drift.
 * Top-level key order is fixed; args (already redacted) are key-sorted; prev links to the previous row's hash.
 */
export function canonicalBody(row: ToolAuditRow, prev: string | null) {
  return JSON.stringify({
    runId: row.runId,
    agentId: row.agentId,
    tool: row.tool,
    tier: row.tier,
    principalId: row.principalId ?? undefined,
    actor: row.actor,
    args: sortKeysDeep(row.args),
    allowed: row.allowed,
    reasons: row.reasons,
    resultStatus: row.resultStatus,
    prev,
  });
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Append-only, hash-chained tool-call audit (tamper-evident). Daily object-lock export comes later. */
@Injectable()
export class AuditService implements OnModuleInit {
  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id uuid PRIMARY KEY, seq bigserial UNIQUE, run_id text NOT NULL, agent_id text NOT NULL, tool text NOT NULL,
        risk_tier text NOT NULL, principal_id text, actor text NOT NULL, args_redacted jsonb NOT NULL,
        opa_allow boolean NOT NULL, opa_reasons jsonb NOT NULL, result_status text NOT NULL,
        prev_hash text, hash text NOT NULL, at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS tool_calls_run ON tool_calls (run_id);`);
  }

  async record(row: ToolAuditRow) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(7311)'); // serialize the chain
      const [last] = await tx.query('SELECT hash FROM tool_calls ORDER BY seq DESC LIMIT 1');
      const prev: string | null = last?.hash ?? null;
      const args = redact(row.args);
      const hash = sha256(canonicalBody({ ...row, args }, prev));
      await tx.query(
        `INSERT INTO tool_calls (id, run_id, agent_id, tool, risk_tier, principal_id, actor, args_redacted, opa_allow, opa_reasons, result_status, prev_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [randomUUID(), row.runId, row.agentId, row.tool, row.tier, row.principalId ?? null, row.actor, JSON.stringify(args), row.allowed, JSON.stringify(row.reasons), row.resultStatus, prev, hash],
      );
    });
  }

  /**
   * Recompute the chain over the most recent `limit` rows: every row's hash must match its canonical body and
   * every prev_hash must equal the previous row's hash. Any edit/delete/insert in the window breaks it.
   */
  async verifyChain(limit = 5000): Promise<boolean> {
    const rows: any[] = await this.db.query(
      `SELECT * FROM (SELECT seq, run_id, agent_id, tool, risk_tier, principal_id, actor, args_redacted, opa_allow, opa_reasons, result_status, prev_hash, hash
                        FROM tool_calls ORDER BY seq DESC LIMIT $1) t ORDER BY seq ASC`,
      [limit],
    );
    let expectedPrev: string | null | undefined;
    for (const r of rows) {
      if (expectedPrev !== undefined && r.prev_hash !== expectedPrev) return false;
      const body = canonicalBody(
        { runId: r.run_id, agentId: r.agent_id, tool: r.tool, tier: r.risk_tier, principalId: r.principal_id ?? undefined, actor: r.actor, args: r.args_redacted, allowed: r.opa_allow, reasons: r.opa_reasons, resultStatus: r.result_status },
        r.prev_hash,
      );
      if (sha256(body) !== r.hash) return false;
      expectedPrev = r.hash;
    }
    return true;
  }
}
