'use server';
import { send } from '@ac/bff';
import { redirect } from 'next/navigation';
import { UUID } from '../../../lib/returns';

const url = (p: string) => `${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300').replace(/\/$/, '')}/account${p}`;

/** Buyer appeals a rejected return → returns service moves the case back to a person. */
export async function appealReturn(fd: FormData) {
  const id = String(fd.get('returnId') ?? '');
  if (!UUID.test(id)) redirect(url('/returns'));
  const note = String(fd.get('note') ?? '').trim();
  if (note.length < 10) redirect(url(`/returns/${id}?err=${encodeURIComponent('Tell us a little more (at least 10 characters).')}`));
  const r = await send('POST', `/api/returns/v1/returns/${id}/appeal`, { note });
  redirect(url(`/returns/${id}?${r.ok ? `ok=${encodeURIComponent('Appeal sent — a member of our team will review your return.')}` : `err=${encodeURIComponent(r.status === 409 ? 'This return can’t be appealed any more.' : r.error)}`}`));
}
