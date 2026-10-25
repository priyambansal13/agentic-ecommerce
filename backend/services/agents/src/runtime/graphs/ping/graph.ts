import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, END, interrupt, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { toolkit } from '../../context.js';
import type { AgentDefinition, AgentGraph } from '../../types.js';
import { config } from './agent.config.js';

/**
 * respond ──(contains "approve")──► approval: interrupt() ──► END
 *        └──────────────────────────────────────────────────► END
 * No LLM: proves AG-UI ⇄ LangGraph ⇄ checkpointer ⇄ invokeTool (OPA + audit) end to end.
 */
const State = Annotation.Root({
  ...MessagesAnnotation.spec,
  approved: Annotation<boolean | null>({ reducer: (_, b) => b, default: () => null }),
});
type S = typeof State.State;

const lastHumanText = (messages: BaseMessage[]) => {
  const m = [...messages].reverse().find((x) => x.getType() === 'human');
  return typeof m?.content === 'string' ? m.content : '';
};

async function respond(state: S, cfg: RunnableConfig) {
  const { echoed } = await toolkit(cfg).call<{ echoed: string }>('echo', { text: lastHumanText(state.messages) });
  return { messages: [new AIMessage(`pong: ${echoed}`)] };
}

async function approval(_state: S) {
  const decision = interrupt({
    reason: 'approval',
    message: 'Approve this ping?',
    responseSchema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'] },
    metadata: { requiredRole: 'support' },
  }) as { approved?: boolean; cancelled?: boolean };
  const approved = decision?.approved === true;
  return { approved, messages: [new AIMessage(approved ? 'Approved — done.' : 'Not approved — closed.')] };
}

const route = (state: S) => (/approve/i.test(lastHumanText(state.messages)) ? 'approval' : END);

export const pingAgent: AgentDefinition = {
  config,
  build: (checkpointer) =>
    new StateGraph(State)
      .addNode('respond', respond)
      .addNode('approval', approval)
      .addEdge(START, 'respond')
      .addConditionalEdges('respond', route, ['approval', END])
      .addEdge('approval', END)
      .compile({ checkpointer }) as unknown as AgentGraph,
  uiState: (v: S) => ({ approved: v.approved }),
};
