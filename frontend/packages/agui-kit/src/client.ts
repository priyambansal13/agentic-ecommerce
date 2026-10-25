import type { BaseEvent } from '@ag-ui/core';

export interface ResumeEntry {
  interruptId: string;
  status: 'resolved' | 'cancelled';
  payload?: unknown;
}
export interface RunInput {
  threadId: string;
  runId: string;
  messages: { id: string; role: 'user' | 'assistant'; content: string }[];
  state?: unknown;
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
  context?: { description: string; value: string }[];
  forwardedProps?: Record<string, unknown>;
  resume?: ResumeEntry[];
}

/**
 * Minimal AG-UI SSE client: POST RunAgentInput, parse `data:` frames into events.
 * The URL is the hosting zone's BFF route (<basePath>/api/agents/<id>/run) — never the agents service directly.
 */
export async function runAgentStream(url: string, input: RunInput, onEvent: (e: BaseEvent) => void, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ state: {}, tools: [], context: [], forwardedProps: {}, ...input }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`agent run failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data) as BaseEvent);
    }
  }
}
