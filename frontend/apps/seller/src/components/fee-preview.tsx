'use client';
import type { FeeBreakdown } from '@ac/contracts';
import { fmtMoney } from '@ac/ui';
import { useEffect, useState } from 'react';

/** Live “what you earn” panel while pricing — fees from the payment service’s ACTIVE schedule. */
export function FeePreview({ category, priceMinor, categoryName }: { category: string; priceMinor?: number; categoryName?: string }) {
  const [fee, setFee] = useState<FeeBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!category || !priceMinor || priceMinor <= 0) {
      setFee(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch('/seller/api/fees/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category, priceMinor, quantity: 1 }), signal: ctl.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setFee(json as FeeBreakdown);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('Fee preview unavailable right now — fees are still charged per the rate card.');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [category, priceMinor]);

  const cur = fee?.currency ?? 'INR';
  const row = (label: string, v: number, hint?: string) => (
    <div className="flex justify-between gap-2 py-0.5">
      <dt>
        {label}
        {hint && <span className="block text-[11px] text-[var(--muted)]">{hint}</span>}
      </dt>
      <dd className="tabular-nums">−{fmtMoney(v, cur)}</dd>
    </div>
  );
  return (
    <aside aria-live="polite" className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)] p-4 text-[13px]">
      <h3 className="text-[15px] font-bold">Fee preview</h3>
      {!priceMinor ? (
        <p className="mt-1 text-[var(--muted)]">Enter a price to see what you earn per unit.</p>
      ) : error ? (
        <p className="mt-1 text-[var(--danger)]">{error}</p>
      ) : !fee ? (
        <p className="mt-1 text-[var(--muted)]">{loading ? 'Calculating…' : '—'}</p>
      ) : (
        <>
          <p className="mt-1">
            You earn <b className="text-[20px] tabular-nums">{fmtMoney(fee.sellerEarnsMinor, cur)}</b> per unit
          </p>
          <p className="text-[var(--muted)]">
            fees {fmtMoney(fee.totalFeesMinor, cur)} ({(fee.effectiveRate * 100).toFixed(1)}% of {fmtMoney(fee.saleMinor, cur)}){loading ? ' · updating…' : ''}
          </p>
          <dl className="mt-2 border-t border-[var(--line)] pt-2">
            <div className="flex justify-between py-0.5">
              <dt>Sale price</dt>
              <dd className="tabular-nums">{fmtMoney(fee.saleMinor, cur)}</dd>
            </div>
            {row('Referral fee', fee.referralMinor, categoryName ? `${categoryName} rate` : undefined)}
            {row('Closing fee', fee.closingMinor, 'by price band')}
            {row('Payment collection fee', fee.paymentMinor)}
            {row('GST on fees (18%)', fee.gstMinor)}
            <div className="mt-1 flex justify-between border-t border-[var(--line)] pt-1 font-bold">
              <dt>You earn</dt>
              <dd className="tabular-nums">{fmtMoney(fee.sellerEarnsMinor, cur)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-[var(--muted)]">Fee schedule v{fee.scheduleVersion}. Shipping and taxes on the sale are not included. GST on fees is claimable as input tax credit.</p>
        </>
      )}
    </aside>
  );
}
