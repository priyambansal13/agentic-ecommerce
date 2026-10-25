import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/** Amazon-style form controls (server components; work with Server Actions and without JS). */

const CONTROL =
  'w-full rounded-[3px] border border-[#888c8c] bg-white px-2 py-1.5 text-[14px] text-[#0f1111] shadow-[0_1px_2px_rgba(15,17,17,.15)_inset] outline-none focus:border-[#e77600] focus:shadow-[0_0_3px_2px_rgba(228,121,17,.5)] dark:bg-[var(--card)] dark:text-[var(--fg)]';

export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="block text-[13px] font-bold">{label}</span>
      {children}
      {error ? (
        <span className="flex items-center gap-1 text-[12px] text-[var(--danger)]">
          <span aria-hidden>!</span>
          {error}
        </span>
      ) : hint ? (
        <span className="block text-[12px] text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

/** React 19: `ref` is a plain prop (used to quick-fill fields). */
export function Input(props: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ''}`} />;
}
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${CONTROL} ${props.className ?? ''}`}>
      {children}
    </select>
  );
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL} ${props.className ?? ''}`} />;
}

type SubmitVariant = 'primary' | 'secondary' | 'outline' | 'danger';
const SUBMIT: Record<SubmitVariant, string> = {
  primary: 'bg-[var(--btn)] border-[var(--btn-border)] text-[#0f1111] hover:brightness-95',
  secondary: 'bg-[var(--btn-2)] border-[var(--btn-2-border)] text-[#0f1111] hover:brightness-95',
  outline: 'bg-[var(--card)] border-[var(--line)] text-[var(--fg)] hover:bg-[var(--surface-2)]',
  danger: 'bg-[var(--card)] border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--surface-2)]',
};
/** Pill <button> (Server Action submit). Same look as `Button`. */
export function SubmitButton({ variant = 'primary', className = '', ...a }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: SubmitVariant }) {
  return <button type="submit" {...a} className={`inline-flex cursor-pointer items-center justify-center rounded-full border px-4 py-1.5 text-[13px] shadow-[0_2px_5px_rgba(213,217,217,.5)] dark:shadow-none disabled:cursor-not-allowed disabled:opacity-50 ${SUBMIT[variant]} ${className}`} />;
}

export type NoticeTone = 'success' | 'error' | 'info' | 'warning';
const NOTICE: Record<NoticeTone, { icon: string; color: string; title: string }> = {
  success: { icon: '✓', color: 'var(--status-good)', title: 'Success' },
  error: { icon: '!', color: 'var(--status-critical)', title: 'There was a problem' },
  info: { icon: 'i', color: 'var(--link)', title: 'Note' },
  warning: { icon: '▲', color: 'var(--status-warning)', title: 'Important' },
};
/** Amazon alert box: coloured left icon + border, bold heading, message. Colour is never the only signal. */
export function Notice({ tone, title, children }: { tone: NoticeTone; title?: string; children?: ReactNode }) {
  const n = NOTICE[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex gap-3 rounded-[var(--radius)] border bg-[var(--card)] p-3 text-[14px]" style={{ borderColor: n.color, boxShadow: `0 0 0 4px color-mix(in srgb, ${n.color} 15%, transparent) inset` }}>
      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: n.color }}>
        {n.icon}
      </span>
      <div>
        <p className="font-bold" style={{ color: tone === 'warning' ? 'var(--fg)' : n.color }}>
          {title ?? n.title}
        </p>
        {children && <div className="mt-0.5">{children}</div>}
      </div>
    </div>
  );
}

/** Automated verification checks: icon + label + detail (pass/fail never colour-only). */
export function CheckList({ checks }: { checks: { check: string; passed: boolean; detail: string }[] }) {
  if (!checks.length) return <p className="text-[13px] text-[var(--muted)]">No automated checks run yet.</p>;
  return (
    <ul className="space-y-1 text-[13px]">
      {checks.map((c) => (
        <li key={c.check} className="flex gap-2">
          <span aria-hidden className="w-4 shrink-0 text-center font-bold" style={{ color: c.passed ? 'var(--status-good)' : 'var(--status-critical)' }}>
            {c.passed ? '✓' : '✕'}
          </span>
          <span>
            <b>{c.check}</b> <span className="sr-only">{c.passed ? 'passed' : 'failed'}</span>— <span className="text-[var(--muted)]">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** White card with optional heading (Amazon "box"). */
export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-[18px] font-bold leading-tight">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
