import type { BaseCheckpointSaver, Command } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export interface AgentConfig {
  id: string;
  version: string;
  description: string;
  /** L0 off · L1 shadow · L2 recommend · L3 bounded auto · L4 auto + sampling (docs/03 §3.3) */
  autonomyDefault: AutonomyLevel;
  /** admins can never raise the agent above this (refund: L3 — L4 needs a new ADR + eval evidence) */
  maxAutonomy: AutonomyLevel;
  /** maxTokens 0 = no LLM; runsPerAgentPerDay caps total runs (auto-downgrade/stop when exceeded) */
  budgets: { maxSteps: number; maxTokens: number; wallClockMs: number; runsPerUserPerDay: number; runsPerAgentPerDay: number };
  /** dev-only agents (ping) may be called without a token */
  public?: boolean;
}

/** Structural type of a compiled LangGraph graph (what the runtime needs). */
export interface AgentGraph {
  stream(input: unknown, config: RunnableConfig & { streamMode: 'updates' }): Promise<AsyncIterable<Record<string, any>>>;
  getState(config: RunnableConfig): Promise<{ values: any; tasks: { interrupts?: { id?: string; value?: unknown }[] }[] }>;
}

export interface AgentDefinition {
  config: AgentConfig;
  build: (checkpointer: BaseCheckpointSaver) => AgentGraph;
  /** user-safe projection of graph state streamed as STATE_SNAPSHOT (never risk scores / rule internals to buyers) */
  uiState?: (values: any) => Record<string, unknown>;
}

export type ResumeInput = Command;
