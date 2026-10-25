import { Field, SubmitButton, Textarea } from '@ac/ui';

/**
 * Approve / request changes / reject with a note. `action` is a Server Action that receives the form; the
 * `version` the reviewer saw goes along for optimistic concurrency (409 when someone else decided first).
 */
export function DecisionForm({ action, id, version, changes = false, noteRequiredHint = 'Required for reject / request changes — the applicant sees it.' }: { action: (fd: FormData) => Promise<void>; id: string; version: number; changes?: boolean; noteRequiredHint?: string }) {
  return (
    <form action={action} className="space-y-2 border-t border-[var(--line)] pt-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <Field label="Note" hint={noteRequiredHint}>
        <Textarea name="note" rows={2} maxLength={500} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="APPROVE">
          Approve
        </SubmitButton>
        {changes && (
          <SubmitButton name="decision" value="REQUEST_CHANGES" variant="outline">
            Request changes
          </SubmitButton>
        )}
        <SubmitButton name="decision" value="REJECT" variant="danger">
          Reject
        </SubmitButton>
      </div>
    </form>
  );
}

/** Read a DecisionForm submission → DecisionInput body; null when a note is missing where it is required. */
export function readDecision(fd: FormData) {
  const decision = String(fd.get('decision') ?? '') as 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  const note = String(fd.get('note') ?? '').trim();
  const version = Number(fd.get('version'));
  return { id: String(fd.get('id') ?? ''), body: { decision, note, version }, missingNote: decision !== 'APPROVE' && !note };
}

/** Absolute URL: a server action that runs before hydration (plain form POST) loses the zone basePath on a relative redirect. */
export const flash = (path: string, kind: 'ok' | 'err', msg: string) => `${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300').replace(/\/$/, '')}/admin${path}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg.slice(0, 300))}`;
/** Service error → message for the reviewer (409 = someone else decided first). */
export const decisionError = (r: { status: number; error: string }) => (r.status === 409 ? 'Someone else already decided this item (or it changed). The queue has been refreshed.' : r.status === 403 ? 'You are not permitted to decide this item.' : r.error);
