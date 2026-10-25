import { sendForm } from '@ac/bff';
import { UUID } from '../../../../../lib/returns';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 8 * 1024 * 1024;

/** Photo evidence for a return: browser → this route (the buyer's token stays server-side) → returns service. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'Unknown return.' }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'Choose a photo to upload.' }, { status: 400 });
  if (!TYPES.includes(file.type)) return Response.json({ error: 'Use a JPEG, PNG or WebP photo.' }, { status: 415 });
  if (file.size > MAX) return Response.json({ error: 'The photo is larger than 8 MB.' }, { status: 413 });
  const out = new FormData();
  out.append('file', file, file.name || 'photo');
  const r = await sendForm('POST', `/api/returns/v1/returns/${id}/evidence`, out, { timeoutMs: 30000 });
  return r.ok ? Response.json({ ok: true }, { status: 201 }) : Response.json({ error: r.error, code: r.code }, { status: r.status });
}
