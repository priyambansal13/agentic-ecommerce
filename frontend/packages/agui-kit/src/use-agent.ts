'use client';
import type { BaseEvent } from '@ag-ui/core';
import { useCallback, useReducer, useRef } from 'react';
import { type RunInput, runAgentStream } from './client.js';
import { agentReducer, type AgentUiState, initialAgentState } from './reducer.js';

const id = () => globalThis.crypto.randomUUID();

/**
 * React hook for one agent conversation, routed through the hosting zone's BFF.
 *   const { ui, send, resume, cancel } = useAgent('refund', { basePath: '/account', threadId: `refund:${caseId}` });
 * Render ui.messages, ui.toolCalls (generative UI by tool name), ui.state, and ui.interrupts (cards).
 */
export function useAgent<S = Record<string, unknown>>(
  agentId: string,
  opts: { threadId?: string; /** zone basePath, e.g. '/shop' — runs go through that zone's BFF */ basePath?: string; initialState?: S; tools?: RunInput['tools'] } = {},
) {
  const [ui, dispatch] = useReducer(agentReducer<S>, initialAgentState<S>(opts.initialState));
  const threadId = useRef(opts.threadId ?? `${agentId}:${id()}`);
  const history = useRef<RunInput['messages']>([]);
  const abort = useRef<AbortController | null>(null);
  const url = `${opts.basePath ?? ''}/api/agents/${agentId}/run`;

  const start = useCallback(
    async (extra: Partial<RunInput>) => {
      abort.current?.abort();
      abort.current = new AbortController();
      const onEvent = (e: BaseEvent) => {
        dispatch(e);
        const ev = e as BaseEvent & { messageId?: string; delta?: string };
        if (e.type === 'TEXT_MESSAGE_START') history.current.push({ id: ev.messageId!, role: 'assistant', content: '' });
        if (e.type === 'TEXT_MESSAGE_CONTENT') {
          const m = history.current.find((x) => x.id === ev.messageId);
          if (m) m.content += ev.delta ?? '';
        }
      };
      try {
        await runAgentStream(url, { threadId: threadId.current, runId: id(), messages: history.current, state: ui.state, tools: opts.tools, ...extra }, onEvent, abort.current.signal);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') dispatch({ type: 'RUN_ERROR', message: (e as Error).message } as BaseEvent);
      }
    },
    [url, ui.state, opts.tools],
  );

  const send = useCallback(
    (text: string) => {
      const msg = { id: id(), role: 'user' as const, content: text };
      history.current.push(msg);
      dispatch({ type: 'TEXT_MESSAGE_START', messageId: msg.id, role: 'user' } as BaseEvent);
      dispatch({ type: 'TEXT_MESSAGE_CONTENT', messageId: msg.id, delta: text } as BaseEvent);
      return start({});
    },
    [start],
  );

  /** Answer the pending interrupt(s), e.g. resume(i.id, { approved: true }). */
  const resume = useCallback(
    (interruptId: string, payload: unknown, status: 'resolved' | 'cancelled' = 'resolved') => start({ resume: [{ interruptId, status, payload }] }),
    [start],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);
  return { ui: ui as AgentUiState<S>, send, resume, cancel, threadId: threadId.current };
}
