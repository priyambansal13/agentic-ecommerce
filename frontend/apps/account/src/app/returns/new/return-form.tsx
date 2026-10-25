'use client';
import { productImageUrl } from '@ac/contracts';
import { Field, fmtMoney, Notice, ProductImage, Select, SubmitButton, Textarea } from '@ac/ui';
import { useActionState, useEffect, useRef, useState } from 'react';
import { REASONS } from '../../../lib/return-text';
import { createReturn, type ReturnFormState } from './actions';

export type ReturnableLine = { productId: string; title: string; qty: number; unitPriceMinor: number; sellerName: string };
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 8 * 1024 * 1024;

/**
 * Amazon-style return flow on one page: items + quantity → reason → description → refund or replacement → photo.
 * After the return is created the photo (optional) is uploaded through the zone route handler, then we go to the
 * return's status page.
 */
export function ReturnForm({ orderId, attempt, currency, lines }: { orderId: string; attempt: string; currency: string; lines: ReturnableLine[] }) {
  const [state, action, pending] = useActionState<ReturnFormState, FormData>(createReturn, {});
  const v = state.values ?? {};
  const [reason, setReason] = useState(v.reasonCode ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [stage, setStage] = useState<'form' | 'uploading' | 'done'>('form');
  const fileRef = useRef<HTMLInputElement>(null);
  const r = REASONS.find((x) => x.code === reason);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // created → upload the photo (if any) → go to the status page
  useEffect(() => {
    if (!state.returnId || stage !== 'form') return;
    const id = state.returnId;
    const go = (q: string) => window.location.assign(`/account/returns/${id}?${q}`);
    if (!file) {
      setStage('done');
      go(`ok=${encodeURIComponent('Return requested. We’ll update you here and by email.')}`);
      return;
    }
    setStage('uploading');
    const fd = new FormData();
    fd.append('file', file);
    fetch(`/account/api/returns/${id}/evidence`, { method: 'POST', body: fd })
      .then(async (res) => {
        setStage('done');
        if (res.ok) go(`ok=${encodeURIComponent('Return requested and your photo was added.')}`);
        else {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          go(`warn=${encodeURIComponent(`Return requested, but the photo didn’t upload${b.error ? ` (${b.error})` : ''}. You can add it on this page.`)}`);
        }
      })
      .catch(() => go(`warn=${encodeURIComponent('Return requested, but the photo didn’t upload. You can add it on this page.')}`));
  }, [state.returnId, file, stage]);

  function pick(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    if (!TYPES.includes(f.type)) return setFileError('Use a JPEG, PNG or WebP photo.');
    if (f.size > MAX) return setFileError('The photo is larger than 8 MB.');
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  const busy = pending || stage !== 'form';
  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="attempt" value={attempt} />
      {state.error && <Notice tone="error">{state.error}</Notice>}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-[18px] font-bold">1. Which items are you returning?</legend>
        <ul className="divide-y divide-[var(--line)] rounded-[var(--radius)] border border-[var(--line)]">
          {lines.map((l) => (
            <li key={l.productId} className="flex flex-wrap items-center gap-3 p-3">
              <input id={`item_${l.productId}`} type="checkbox" name="item" value={l.productId} defaultChecked={lines.length === 1} className="h-5 w-5 accent-[var(--accent)]" />
              <label htmlFor={`item_${l.productId}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <span className="shrink-0 rounded-md border border-[var(--line)] bg-white p-1">
                  <ProductImage src={productImageUrl(l.productId, 'thumb')} category="" title={l.title} box={64} />
                </span>
                <span className="min-w-0 text-[14px]">
                  <span className="block font-bold">{l.title}</span>
                  <span className="block text-[12px] text-[var(--muted)]">
                    Sold by {l.sellerName} · {fmtMoney(l.unitPriceMinor, currency)} each · ordered {l.qty}
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-1 text-[13px]">
                Qty
                <Select name={`qty_${l.productId}`} defaultValue={String(Math.min(l.qty, Number(v[`qty_${l.productId}`] ?? l.qty)))} aria-label={`Quantity of ${l.title} to return`}>
                  {Array.from({ length: l.qty }, (_, i) => i + 1).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-[18px] font-bold">2. Why are you returning them?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {REASONS.map((x) => (
            <label key={x.code} className={`flex cursor-pointer gap-2 rounded-[var(--radius)] border p-3 text-[14px] ${reason === x.code ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--line)]'}`}>
              <input type="radio" name="reasonCode" value={x.code} checked={reason === x.code} onChange={() => setReason(x.code)} className="mt-0.5 accent-[var(--accent)]" />
              <span>{x.label}</span>
            </label>
          ))}
        </div>
        {r && <p className="text-[13px] text-[var(--muted)]">{r.hint}</p>}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-[18px] font-bold">3. Tell us what happened</legend>
        <Field label="Describe the problem" hint="At least 10 characters. Our team and the review system read this.">
          <Textarea name="buyerText" rows={4} minLength={10} maxLength={2000} defaultValue={v.buyerText} required />
        </Field>
        <Field label="What would you like?">
          <Select name="preferred" defaultValue={v.preferred ?? 'REFUND'}>
            <option value="REFUND">Refund to my original payment method</option>
            <option value="REPLACEMENT">Replacement of the same item</option>
          </Select>
        </Field>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-[18px] font-bold">
          4. Add a photo <span className="text-[14px] font-normal text-[var(--muted)]">({r?.photo ? 'recommended' : 'optional'})</span>
        </legend>
        <div
          className="flex flex-wrap items-center gap-4 rounded-[var(--radius)] border border-dashed border-[var(--line)] p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files[0]);
          }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={preview} alt="Photo to upload" className="h-24 w-24 rounded-md border border-[var(--line)] object-cover" />
          ) : (
            <span aria-hidden className="flex h-24 w-24 items-center justify-center rounded-md bg-[var(--surface-2)] text-[28px] text-[var(--muted)]">
              ⊕
            </span>
          )}
          <div className="space-y-1 text-[13px]">
            <p>Drag a photo here, or</p>
            <button type="button" className="rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-[13px] hover:bg-[var(--surface-2)]" onClick={() => fileRef.current?.click()}>
              {file ? 'Choose a different photo' : 'Choose a photo'}
            </button>
            {file && (
              <button type="button" className="ml-2 text-[var(--link)] hover:underline" onClick={() => { setFile(null); setPreview(null); }}>
                Remove
              </button>
            )}
            <p className="text-[var(--muted)]">JPEG, PNG or WebP, up to 8 MB.</p>
            {fileError && <p role="alert" className="text-[var(--danger)]">{fileError}</p>}
          </div>
          <input ref={fileRef} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
        <SubmitButton disabled={busy}>{stage === 'uploading' ? 'Uploading photo…' : busy ? 'Submitting…' : 'Submit return request'}</SubmitButton>
        <span className="text-[13px] text-[var(--muted)]">You won’t be charged. We’ll tell you what happens next on the return’s page.</span>
      </div>
    </form>
  );
}
