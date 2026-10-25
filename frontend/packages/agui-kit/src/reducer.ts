import { type BaseEvent, EventType } from '@ag-ui/core';
import fjp from 'fast-json-patch';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}
export interface UiToolCall {
  id: string;
  name: string;
  argsText: string;
  args?: unknown;
  result?: unknown;
  done: boolean;
  parentMessageId?: string;
}
export interface UiInterrupt {
  id: string;
  reason: string;
  message?: string;
  responseSchema?: Record<string, unknown>;
  metadata?: Record<string, any>;
}
export interface AgentUiState<S = Record<string, unknown>> {
  status: 'idle' | 'running' | 'interrupted' | 'cancelled' | 'error';
  threadId?: string;
  runId?: string;
  messages: UiMessage[];
  toolCalls: Record<string, UiToolCall>;
  /** order in which tool calls appeared, for rendering */
  toolOrder: string[];
  activeSteps: string[];
  state: S;
  interrupts: UiInterrupt[];
  error?: string;
}

export const initialAgentState = <S = Record<string, unknown>>(state = {} as S): AgentUiState<S> => ({
  status: 'idle',
  messages: [],
  toolCalls: {},
  toolOrder: [],
  activeSteps: [],
  state,
  interrupts: [],
});

const tryJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/**
 * Pure AG-UI 1.0 event → UI state reducer (use with useReducer or the useAgent hook).
 * Interrupts are native: RUN_FINISHED with outcome.type === 'interrupt' carries outcome.interrupts[].
 */
export function agentReducer<S>(s: AgentUiState<S>, e: BaseEvent): AgentUiState<S> {
  const ev = e as BaseEvent & Record<string, any>;
  switch (e.type) {
    case EventType.RUN_STARTED:
      return { ...s, status: 'running', threadId: ev.threadId, runId: ev.runId, interrupts: [], error: undefined };
    case EventType.RUN_FINISHED: {
      const outcome = ev.outcome as { type: string; interrupts?: UiInterrupt[] } | undefined;
      if (outcome?.type === 'interrupt') return { ...s, status: 'interrupted', interrupts: outcome.interrupts ?? [], activeSteps: [] };
      if (outcome?.type === 'cancelled') return { ...s, status: 'cancelled', activeSteps: [] };
      return { ...s, status: 'idle', activeSteps: [] };
    }
    case EventType.RUN_ERROR:
      return { ...s, status: 'error', error: ev.message ?? 'Agent run failed', activeSteps: [] };
    case EventType.STEP_STARTED:
      return { ...s, activeSteps: [...s.activeSteps, ev.stepName] };
    case EventType.STEP_FINISHED:
      return { ...s, activeSteps: s.activeSteps.filter((x) => x !== ev.stepName) };
    case EventType.TEXT_MESSAGE_START:
      return { ...s, messages: [...s.messages, { id: ev.messageId, role: ev.role ?? 'assistant', content: '' }] };
    case EventType.TEXT_MESSAGE_CONTENT:
      return { ...s, messages: s.messages.map((m) => (m.id === ev.messageId ? { ...m, content: m.content + ev.delta } : m)) };
    case EventType.TOOL_CALL_START:
      return {
        ...s,
        toolOrder: [...s.toolOrder, ev.toolCallId],
        toolCalls: { ...s.toolCalls, [ev.toolCallId]: { id: ev.toolCallId, name: ev.toolCallName, argsText: '', done: false, parentMessageId: ev.parentMessageId } },
      };
    case EventType.TOOL_CALL_ARGS: {
      const t = s.toolCalls[ev.toolCallId];
      return t ? { ...s, toolCalls: { ...s.toolCalls, [t.id]: { ...t, argsText: t.argsText + ev.delta } } } : s;
    }
    case EventType.TOOL_CALL_END: {
      const t = s.toolCalls[ev.toolCallId];
      return t ? { ...s, toolCalls: { ...s.toolCalls, [t.id]: { ...t, args: tryJson(t.argsText) } } } : s;
    }
    case EventType.TOOL_CALL_RESULT: {
      const t = s.toolCalls[ev.toolCallId];
      return t ? { ...s, toolCalls: { ...s.toolCalls, [t.id]: { ...t, result: tryJson(ev.content), done: true } } } : s;
    }
    case EventType.STATE_SNAPSHOT:
      return { ...s, state: ev.snapshot as S };
    case EventType.STATE_DELTA:
      return { ...s, state: fjp.applyPatch(structuredClone(s.state), ev.delta, false, false).newDocument as S };
    case EventType.MESSAGES_SNAPSHOT:
      return {
        ...s,
        messages: (ev.messages ?? [])
          .filter((m: any) => typeof m.content === 'string')
          .map((m: any) => ({ id: m.id, role: m.role, content: m.content })),
      };
    default:
      return s;
  }
}
