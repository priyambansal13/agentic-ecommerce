import type { AgentConfig } from '../../types.js';

/**
 * Refund & Returns agent (docs/03 A1). Rollout: L1 shadow (default) → L2 recommend → L3 bounded auto (max).
 * L4 is not allowed for money without a new ADR and eval evidence.
 */
export const config: AgentConfig = {
  id: 'refund',
  version: '1.0.0',
  description: 'Governed refund & returns agent: classifies the claim, applies the deterministic refund policy, proposes a resolution; executes small low-risk refunds only at L3 inside the OPA envelope.',
  autonomyDefault: 1,
  maxAutonomy: 3,
  budgets: { maxSteps: 12, maxTokens: 20_000, wallClockMs: 60_000, runsPerUserPerDay: 20, runsPerAgentPerDay: 5_000 },
};
