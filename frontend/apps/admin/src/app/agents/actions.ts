'use server';
import { send } from '@ac/bff';
import { AutonomyInputSchema } from '@ac/contracts';
import { redirect } from 'next/navigation';
import { flash } from '../../lib/decide';

const AGENT = /^[a-z][a-z0-9-]{1,40}$/;

/** Admin changes an agent's autonomy level (audited by the agents service; effective within ~10 s). */
export async function setAutonomy(fd: FormData) {
  const agentId = String(fd.get('agentId') ?? '');
  if (!AGENT.test(agentId)) redirect(flash('/agents', 'err', 'Unknown agent.'));
  const body = AutonomyInputSchema.safeParse({ level: Number(fd.get('level')), reason: String(fd.get('reason') ?? '').trim() });
  if (!body.success) redirect(flash('/agents', 'err', 'Give a reason (at least 5 characters) for the change.'));
  const r = await send('PUT', `/api/agents/v1/agents/${agentId}/autonomy`, body.data);
  redirect(flash('/agents', r.ok ? 'ok' : 'err', r.ok ? `${agentId}: autonomy set to L${body.data.level}.` : r.status === 403 ? 'Only admins can change autonomy.' : r.status === 422 || r.status === 400 ? r.error : `Couldn’t change autonomy: ${r.error}`));
}
