import { describe, expect, it } from 'vitest';
import { canonicalBody, type ToolAuditRow } from './audit.service.js';

const row: ToolAuditRow = {
  runId: 'r1',
  agentId: 'ping',
  tool: 'echo',
  tier: 'READ',
  principalId: undefined,
  actor: 'agent:ping',
  args: { text: 'hi', meta: { b: 2, a: 1 } },
  allowed: true,
  reasons: [],
  resultStatus: 'OK',
};

describe('audit canonical body', () => {
  it('is independent of args key order (Postgres jsonb reorders keys)', () => {
    const reordered = { ...row, args: { meta: { a: 1, b: 2 }, text: 'hi' } };
    expect(canonicalBody(reordered, 'p')).toBe(canonicalBody(row, 'p'));
  });
  it('changes when any audited field or the previous hash changes', () => {
    const base = canonicalBody(row, 'p');
    expect(canonicalBody({ ...row, tool: 'echoX' }, 'p')).not.toBe(base);
    expect(canonicalBody({ ...row, allowed: false }, 'p')).not.toBe(base);
    expect(canonicalBody(row, 'q')).not.toBe(base);
  });
  it('keeps the historical layout for single-key args (pre-existing rows stay verifiable)', () => {
    const legacy = { ...row, args: { text: 'hi' } };
    const { args, ...rest } = legacy;
    const old = JSON.stringify({ runId: rest.runId, agentId: rest.agentId, tool: rest.tool, tier: rest.tier, principalId: rest.principalId, actor: rest.actor, args, allowed: rest.allowed, reasons: rest.reasons, resultStatus: rest.resultStatus, prev: 'p' });
    expect(canonicalBody(legacy, 'p')).toBe(old);
  });
});
