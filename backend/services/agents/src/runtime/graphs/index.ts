import type { AgentDefinition } from '../types.js';
import { pingAgent } from './ping/graph.js';
import { refundAgent } from './refund/graph.js';
// ac:agents-import

/** Graph registry. `pnpm ac new agent <id>` inserts entries at the markers — keep them. */
export const AGENTS: Record<string, AgentDefinition> = {
  ping: pingAgent,
  refund: refundAgent,
  // ac:agents-entry
};
