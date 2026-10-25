import type { z } from 'zod';
import type { RunContext } from '../runtime/context.js';

export type ToolTier = 'READ' | 'WRITE_REVERSIBLE' | 'WRITE_IRREVERSIBLE' | 'MONEY';

export interface ToolCallContext extends RunContext {
  toolCallId: string;
  /** `${runId}:${toolCallId}` — send as Idempotency-Key on every mutating domain call */
  idempotencyKey: string;
}

export interface ToolDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  /** model-facing: precise, no hype */
  description: string;
  tier: ToolTier;
  /** OAuth scope the exchanged agent token must carry (enforced by the domain service) */
  scope?: string;
  /** agents allowed by code (OPA data.json agent_tools is the authoritative allow-list) */
  agents: string[];
  input: I;
  output: O;
  /** extra facts OPA needs (case status, refundable amount …) — fetched server-side, never from model args */
  opaContext?: (ctx: ToolCallContext, args: z.infer<I>) => Promise<Record<string, unknown>>;
  handler: (ctx: ToolCallContext, args: z.infer<I>) => Promise<z.infer<O>>;
}

export const defineTool = <I extends z.ZodType, O extends z.ZodType>(def: ToolDefinition<I, O>) => def;
