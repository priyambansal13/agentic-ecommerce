import { agentRoute } from '@ac/bff';

/** Zone BFF for AG-UI: /account/api/agents/<id>/run → Kong → agents service. Only this zone's agents. */
export const dynamic = 'force-dynamic';
export const POST = agentRoute({ allow: ["refund","order-support","ping"] });
