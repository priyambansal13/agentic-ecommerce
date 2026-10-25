'use client';
import { type DragEvent, useEffect, useRef, useState } from 'react';

export const MAX_IMAGES = 5;
export const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Product photo picker: up to 5 JPEG/PNG/WebP files (≤ 5 MB each), drag & drop, previews, reorder (first = main
 * image), remove. The chosen files stay on a real <input type=file name={name}> so the Server Action receives them
 * (and they survive React's form reset after a failed submit). The catalog service re-checks everything.
 */
export function ImagePicker({ name = 'images', max = MAX_IMAGES }: { name?: string; max?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);

  // keep the input's FileList in sync with our ordered list
  const sync = (list: File[]) => {
    if (!input.current) return;
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(f);
    input.current.files = dt.files;
  };
  useEffect(() => {
    sync(files);
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [files]);
  // React resets the form after each action → restore the files
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const onReset = () => setTimeout(() => sync(files), 0);
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [files]);

  const add = (picked: FileList | null) => {
    if (!picked) return;
    const problems: string[] = [];
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (!TYPES.includes(f.type)) problems.push(`${f.name}: use JPEG, PNG or WebP`);
      else if (f.size > MAX_BYTES) problems.push(`${f.name}: larger than 5 MB`);
      else if (next.length >= max) problems.push(`Only ${max} images per product`);
      else if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setError([...new Set(problems)].join(' · '));
    setFiles(next);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= files.length) return;
    const next = [...files];
    [next[i], next[j]] = [next[j], next[i]];
    setFiles(next);
  };
  const remove = (i: number) => setFiles(files.filter((_, k) => k !== i));
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-[var(--radius)] border-2 border-dashed px-4 py-6 text-center text-[13px] ${over ? 'border-[var(--link)] bg-[var(--surface-2)]' : 'border-[var(--line)]'}`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-8 w-8 text-[var(--muted)]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 16l4-4 3 3 5-5 4 4 M4 5h16v14H4z M9 9h.01" />
        </svg>
        <p>
          Drag photos here or{' '}
          <button type="button" className="text-[var(--link)] underline" onClick={() => input.current?.click()} disabled={files.length >= max}>
            choose files
          </button>
        </p>
        <p className="text-[var(--muted)]">
          Up to {max} · JPEG, PNG or WebP · max 5 MB · at least 500 px · white background works best. The first photo is the main image.
        </p>
        <input ref={input} type="file" name={name} accept={TYPES.join(',')} multiple className="sr-only" tabIndex={-1} onChange={(e) => add(e.target.files)} aria-label="Product photos" />
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-[var(--danger)]">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <ol className="flex flex-wrap gap-3" aria-label="Selected photos (first = main image)">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}`} className="w-[104px] space-y-1 text-[11px]">
              <div className={`relative flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-md border bg-white ${i === 0 ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/40' : 'border-[var(--line)]'}`}>
                {urls[i] && <img src={urls[i]} alt={f.name} className="h-full w-full object-contain" />}
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-[var(--nav)] px-1 text-[10px] text-white">MAIN</span>}
              </div>
              <p className="truncate" title={f.name}>
                {f.name}
              </p>
              <div className="flex gap-1">
                <button type="button" aria-label={`Move ${f.name} left`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded border border-[var(--line)] px-1.5 disabled:opacity-40">
                  ←
                </button>
                <button type="button" aria-label={`Move ${f.name} right`} disabled={i === files.length - 1} onClick={() => move(i, 1)} className="rounded border border-[var(--line)] px-1.5 disabled:opacity-40">
                  →
                </button>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => remove(i)} className="ml-auto rounded border border-[var(--line)] px-1.5 text-[var(--danger)]">
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
