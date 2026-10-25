import { AgentChat } from '@ac/agent-widget';
import { Page } from '@ac/ui';
import { requireStaff } from '../../../lib/guard';

export default async function PingCheck() {
  const g = await requireStaff('/admin/agents');
  if ('denied' in g) return g.denied;
  return (
    <Page title="Agent platform check" intro="Every message calls the governed echo tool (OPA + audit). Include “approve” to trigger a human-in-the-loop interrupt.">
      <AgentChat agentId="ping" basePath="/admin" initialMessage="please approve this" />
    </Page>
  );
}
