import { randomUUID } from 'node:crypto';

/**
 * Langfuse tracing over its public ingestion API (no SDK dependency). Enabled when LANGFUSE_PUBLIC_KEY and
 * LANGFUSE_SECRET_KEY are set (compose `--llmops` → http://localhost:53100, LANGFUSE_HOST overrides); otherwise
 * every call is a no-op. One trace per agent run, one span per graph node, one generation per model call.
 * Inputs are already PII-redacted by the caller; flush is best effort and never fails a run.
 */
export class RunTrace {
  private readonly events: Record<string, unknown>[] = [];
  readonly traceId = randomUUID();
  constructor(private readonly name: string, private readonly metadata: Record<string, unknown>) {
    if (!RunTrace.enabled()) return;
    this.push('trace-create', { id: this.traceId, name, metadata, timestamp: new Date().toISOString() });
  }

  static enabled() {
    return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
  }

  private push(type: string, body: Record<string, unknown>) {
    this.events.push({ id: randomUUID(), type, timestamp: new Date().toISOString(), body });
  }

  span(name: string, startedAt: Date, input: unknown, output: unknown) {
    if (!RunTrace.enabled()) return;
    this.push('span-create', { id: randomUUID(), traceId: this.traceId, name, startTime: startedAt.toISOString(), endTime: new Date().toISOString(), input, output });
  }

  generation(name: string, model: string, startedAt: Date, input: unknown, output: unknown, usage: { input: number; output: number }) {
    if (!RunTrace.enabled()) return;
    this.push('generation-create', { id: randomUUID(), traceId: this.traceId, name, model, startTime: startedAt.toISOString(), endTime: new Date().toISOString(), input, output, usage: { input: usage.input, output: usage.output, unit: 'TOKENS' } });
  }

  async flush(output: unknown) {
    if (!RunTrace.enabled()) return;
    this.push('trace-create', { id: this.traceId, name: this.name, metadata: this.metadata, output });
    const host = (process.env.LANGFUSE_HOST ?? 'http://localhost:53100').replace(/\/$/, '');
    const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString('base64');
    await fetch(`${host}/api/public/ingestion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify({ batch: this.events }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined);
  }
}
