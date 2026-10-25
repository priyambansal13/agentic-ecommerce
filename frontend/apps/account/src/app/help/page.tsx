import { AgentChat } from '@ac/agent-widget';
import { Breadcrumb, Forbidden, Page } from '@ac/ui';
import { requireBuyer } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Customer Service: the refund / order-support agent (ping stands in until the real agents ship). */
export default async function CustomerService({ searchParams }: { searchParams: Promise<{ order?: string; intent?: string }> }) {
  const { order, intent } = await searchParams;
  const { session, ok } = await requireBuyer('/account/help');
  if (!ok) return <Forbidden need="buyer" signedInAs={session.name} />;
  const first = order ? (intent === 'return' ? `I want to return items from order ${order}` : `I need help with order ${order}`) : '';
  return (
    <Page title="Customer Service" intro="Tell us what happened — our assistant can check your order, start a return and, for anything outside policy, hand over to a person.">
      <Breadcrumb items={[{ href: '/account', label: 'Your Account' }, { label: 'Customer Service' }]} />
      <AgentChat agentId="ping" basePath="/account" title="Assistant (platform check — the refund agent arrives in P3; type “approve” to see a human-approval step)" initialMessage={first} />
    </Page>
  );
}
