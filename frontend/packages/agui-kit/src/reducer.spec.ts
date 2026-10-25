import { type BaseEvent, EventType } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';
import { agentReducer, initialAgentState } from './reducer.js';

const run = (events: Record<string, unknown>[]) => events.reduce((s, e) => agentReducer(s, e as BaseEvent), initialAgentState());

describe('agentReducer', () => {
  it('streams text, tool calls and state deltas', () => {
    const s = run([
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'r' },
      { type: EventType.STATE_SNAPSHOT, snapshot: { case: { status: 'REQUESTED' } } },
      { type: EventType.TOOL_CALL_START, toolCallId: 'c1', toolCallName: 'getOrder' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'c1', delta: '{"orderId":"o1"}' },
      { type: EventType.TOOL_CALL_END, toolCallId: 'c1' },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'm0', toolCallId: 'c1', content: '{"status":"DELIVERED"}' },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Hello ' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'there' },
      { type: EventType.STATE_DELTA, delta: [{ op: 'replace', path: '/case/status', value: 'REFUND_PENDING' }] },
      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'r', outcome: { type: 'success' } },
    ]);
    expect(s.status).toBe('idle');
    expect(s.messages[0].content).toBe('Hello there');
    expect(s.toolCalls.c1).toMatchObject({ name: 'getOrder', args: { orderId: 'o1' }, result: { status: 'DELIVERED' }, done: true });
    expect((s.state as any).case.status).toBe('REFUND_PENDING');
  });

  it('captures native interrupts from RUN_FINISHED', () => {
    const s = run([
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'r' },
      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'r', outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'offer', metadata: { options: ['REFUND'] } }] } },
    ]);
    expect(s.status).toBe('interrupted');
    expect(s.interrupts[0]).toMatchObject({ id: 'i1', reason: 'offer' });
  });
});
