'use server';
import { send } from '@ac/bff';
import { CaseApproveInputSchema, CaseRejectInputSchema } from '@ac/contracts';
import { redirect } from 'next/navigation';
import { flash } from '../../../lib/decide';
import { UUID } from '../../../lib/refunds';

const failure = (r: { status: number; error: string }) =>
  r.status === 503 ? 'We couldn’t confirm the decision in time — refresh the case to see whether it was recorded before trying again.'
  : r.status === 409 ? 'Someone else already decided this case (or it changed). The page has been refreshed.'
  : r.status === 403 ? r.error && r.error !== 'You are not permitted to do this.' ? r.error : 'You are not permitted to decide this case (dual control: the second approval must come from a different person in finance).'
  : r.error;

/** Support approves (or finance gives the second approval under dual control). Amount entered in rupees. */
export async function approveCase(fd: FormData) {
  const caseId = String(fd.get('caseId') ?? '');
  if (!UUID.test(caseId)) redirect(flash('/support', 'err', 'Unknown case.'));
  const rupees = Number(String(fd.get('amount') ?? '').replace(/[,₹\s]/g, ''));
  const body = CaseApproveInputSchema.safeParse({
    outcome: fd.get('outcome'),
    amountMinor: Number.isFinite(rupees) ? Math.round(rupees * 100) : NaN,
    note: String(fd.get('note') ?? '').trim(),
    version: Number(fd.get('version')),
  });
  if (!body.success) redirect(flash(`/support/${caseId}`, 'err', 'Check the outcome and amount.'));
  const r = await send('POST', `/api/returns/v1/refund-cases/${caseId}/approve`, body.data, { idempotencyKey: `approve-${caseId}-${body.data.version}`, timeoutMs: 20000 }); // approval may execute the refund synchronously
  redirect(flash(`/support/${caseId}`, r.ok ? 'ok' : 'err', r.ok ? 'Decision recorded.' : failure(r)));
}

export async function rejectCase(fd: FormData) {
  const caseId = String(fd.get('caseId') ?? '');
  if (!UUID.test(caseId)) redirect(flash('/support', 'err', 'Unknown case.'));
  const body = CaseRejectInputSchema.safeParse({ note: String(fd.get('note') ?? '').trim(), version: Number(fd.get('version')) });
  if (!body.success) redirect(flash(`/support/${caseId}`, 'err', 'Add a note (at least 5 characters) — the buyer sees an explanation based on it.'));
  const r = await send('POST', `/api/returns/v1/refund-cases/${caseId}/reject`, body.data, { timeoutMs: 20000 });
  redirect(flash(`/support/${caseId}`, r.ok ? 'ok' : 'err', r.ok ? 'Case rejected.' : failure(r)));
}
