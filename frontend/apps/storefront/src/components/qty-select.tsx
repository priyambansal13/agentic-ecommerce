'use client';
import { Select } from '@ac/ui';

/** Quantity dropdown that submits its form on change (Amazon cart); the Update button covers no-JS. */
export function QtySelect({ value, max }: { value: number; max: number }) {
  const top = Math.max(value, Math.min(10, max));
  return (
    <label className="inline-flex items-center gap-1 text-[13px]">
      <span className="sr-only">Quantity</span>
      Qty:
      <Select name="qty" defaultValue={String(value)} className="!w-auto !py-0.5" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {Array.from({ length: Math.max(1, top) }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </Select>
      <noscript>
        <button type="submit" name="intent" value="update" className="text-[12px] text-[var(--link)] underline">
          Update
        </button>
      </noscript>
    </label>
  );
}
