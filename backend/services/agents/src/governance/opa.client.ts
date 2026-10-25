import { Injectable, Logger } from '@nestjs/common';

export interface OpaDecision {
  allow: boolean;
  reasons: string[];
}

/** Queries policies/agents/tools.rego. Fails CLOSED: any error → deny. */
@Injectable()
export class OpaClient {
  private readonly log = new Logger(OpaClient.name);

  async decide(input: Record<string, unknown>): Promise<OpaDecision> {
    const url = `${process.env.OPA_URL ?? 'http://localhost:58181'}/v1/data/agents/tools/decision`;
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }), signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { result } = (await r.json()) as { result?: { allow?: boolean; reasons?: string[] } };
      return { allow: result?.allow === true, reasons: result?.reasons ?? [] };
    } catch (e) {
      this.log.error(`OPA unavailable, denying: ${(e as Error).message}`);
      return { allow: false, reasons: ['policy engine unavailable'] };
    }
  }
}
