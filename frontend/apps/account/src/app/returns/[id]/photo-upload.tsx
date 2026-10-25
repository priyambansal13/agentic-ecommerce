'use client';
import { useRef, useState } from 'react';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Add a photo to an open return (uploaded through the zone route handler, then the page refreshes). */
export function PhotoUpload({ returnId }: { returnId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(f?: File) {
    setError(null);
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('Use a JPEG, PNG or WebP photo.');
    if (f.size > 8 * 1024 * 1024) return setError('The photo is larger than 8 MB.');
    setBusy(true);
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch(`/account/api/returns/${returnId}/evidence`, { method: 'POST', body: fd }).catch(() => null);
    if (res?.ok) window.location.assign(`/account/returns/${returnId}?ok=${encodeURIComponent('Photo added — thank you.')}`);
    else {
      const b = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(b?.error ?? 'The photo didn’t upload. Please try again.');
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1">
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="inline-flex items-center rounded-full border border-[var(--btn-border)] bg-[var(--btn)] px-4 py-1.5 text-[13px] text-[#0f1111] hover:brightness-95 disabled:opacity-60">
        {busy ? 'Uploading…' : 'Add a photo'}
      </button>
      <input ref={ref} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => upload(e.target.files?.[0])} />
      {error && <p role="alert" className="text-[13px] text-[var(--danger)]">{error}</p>}
    </div>
  );
}
