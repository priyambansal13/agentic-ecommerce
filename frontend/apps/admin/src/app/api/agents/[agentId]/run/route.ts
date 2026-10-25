import { agentRoute } from '@ac/bff';

/** Zone BFF for AG-UI: /admin/api/agents/<id>/run → Kong → agents service. Only this zone's agents. */
export const dynamic = 'force-dynamic';
export const POST = agentRoute({ allow: ["fraud-investigator","dispute","ping"] });
