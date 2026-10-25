import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type { PolicyResult, ReasonCode, Resolution } from '@ac/contracts';
import { offlineRefundModel } from './models/offline.js';
import { openAiRefundModel } from './models/openai.js';

/**
 * Model tiers (docs/03 §3.2). Exact model ids come from env (.env MODEL_*) so swaps are config +
 * eval-gated, never code edits. Temperature 0 for decisions; raise only for copywriting nodes.
 *
 * Provider selection — MODEL_PROVIDER=auto (default) | openai | offline:
 *   auto    → OpenAI when OPENAI_API_KEY is set, else the deterministic OFFLINE provider
 *   offline → documented heuristics (runtime/models/offline.ts) — dev, CI and evals without a key
 * Graph code depends only on the task interfaces below and never branches on the provider.
 */
export type ModelProviderId = 'openai' | 'offline';

export function modelProvider(): ModelProviderId {
  const p = (process.env.MODEL_PROVIDER ?? 'auto').toLowerCase();
  if (p === 'offline') return 'offline';
  if (p === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw new Error('MODEL_PROVIDER=openai but OPENAI_API_KEY is not set — run: ac configure');
    return 'openai';
  }
  return process.env.OPENAI_API_KEY ? 'openai' : 'offline';
}

function key() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set — run: ac configure');
  return process.env.OPENAI_API_KEY;
}
const chat = (model: string, temperature = 0) => new ChatOpenAI({ apiKey: key(), model, temperature, maxRetries: 2, timeout: 60_000 });

export const modelIds = {
  fast: () => process.env.MODEL_FAST ?? 'gpt-4.1-mini',
  smart: () => process.env.MODEL_SMART ?? 'gpt-4.1',
};

/** Raw OpenAI chat models (only valid when the provider is openai). */
export const models = {
  fast: (t?: number) => chat(modelIds.fast(), t),
  smart: (t?: number) => chat(modelIds.smart(), t),
  vision: (t?: number) => chat(process.env.MODEL_VISION ?? 'gpt-4.1', t),
  embed: () => new OpenAIEmbeddings({ apiKey: key(), model: process.env.MODEL_EMBED ?? 'text-embedding-3-small', dimensions: Number(process.env.EMBED_DIMENSIONS ?? 512) }),
};

// ---------------------------------------------------------------- refund agent task interfaces

export interface ClaimLine {
  title: string;
  category: string;
  qty: number;
}
export interface ClassifyInput {
  statedReason: ReasonCode;
  /** PII-redacted, untrusted */
  buyerText: string;
  preferred: 'REFUND' | 'REPLACEMENT';
  lines: ClaimLine[];
}
export interface Classification {
  reasonCode: ReasonCode;
  reasonConfidence: number;
  /** the text describes a different problem than the stated reason code */
  mismatch: boolean;
  injection: boolean;
  mentionsPhoto: boolean;
  summary: string;
}
export interface ProposeInput {
  currency: string;
  reasonCode: ReasonCode;
  preferred: 'REFUND' | 'REPLACEMENT';
  requestedMinor: number;
  refundableMinor: number;
  policy: PolicyResult;
  riskScore: number;
  signals: string[];
  hasPhoto: boolean;
  classification: Classification;
}
export interface ProposalDraft {
  outcome: Resolution;
  amountMinor: number;
  confidence: number;
  summary: string;
  buyerExplanation: string;
}
export type UsageMeter = (u: { input: number; output: number; model: string; task: string; startedAt: Date; prompt: unknown; result: unknown }) => void;

export interface RefundModel {
  readonly provider: ModelProviderId;
  /** model id(s) for run records / eval reports */
  readonly name: string;
  classify(input: ClassifyInput, meter: UsageMeter): Promise<Classification>;
  propose(input: ProposeInput, meter: UsageMeter): Promise<ProposalDraft>;
}

/** The refund model for the current provider (evals may force offline/openai via MODEL_PROVIDER). */
export function refundModel(): RefundModel {
  return modelProvider() === 'openai' ? openAiRefundModel() : offlineRefundModel;
}
