import type { ToolDefinition } from './define-tool.js';
import { echo } from './definitions/echo.js';
import { REFUND_TOOLS } from './definitions/refund.js';

/** Every tool an agent can call. Add new ones via the agent-tool skill (definition + OPA rule + test). */
export const TOOLS: Record<string, ToolDefinition<any, any>> = Object.fromEntries([echo, ...REFUND_TOOLS].map((t) => [t.name, t]));

export const toolsFor = (agentId: string) => Object.values(TOOLS).filter((t) => t.agents.includes(agentId));
