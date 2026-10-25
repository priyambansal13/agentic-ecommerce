import type { AgentConfig } from '../../types.js';

export const config: AgentConfig = {
  id: 'ping',
  version: '0.1.0',
  description: 'Diagnostics agent: echoes via a governed tool and asks for approval when the message contains "approve".',
  autonomyDefault: 2,
  maxAutonomy: 2,
  budgets: { maxSteps: 8, maxTokens: 0, wallClockMs: 30_000, runsPerUserPerDay: 500, runsPerAgentPerDay: 50_000 },
  public: true,
};
