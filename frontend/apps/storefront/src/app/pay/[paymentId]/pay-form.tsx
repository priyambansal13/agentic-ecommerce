'use client';
import { Field, Input, Notice, SubmitButton } from '@ac/ui';
import { useActionState, useEffect, useRef, useState } from 'react';
import { type PayState, payWithTestCard } from '../actions';

const CARDS = [
  { label: 'Succeeds', number: '4242 4242 4242 4242' },
  { label: 'Declined', number: '4000 0000 0000 0002' },
  { label: 'Insufficient funds', number: '4000 0000 0000 9995' },
];
type Phase = 'form' | 'processing' | 'failed' | 'expired';

/** TEST MODE card form → server action → poll the payment (truth arrives by webhook) → thanks page. */
export function PayForm({ paymentId, orderId, amountText, expiresAt, initialFailure, idem }: { paymentId: string; orderId: string; amountText: string; expiresAt: string; initialFailure: string | null; idem: string }) {
  const [state, action, pending] = useActionState<PayState, FormData>(payWithTestCard, {});
  const [phase, setPhase] = useState<Phase>('form');
  const [failure, setFailure] = useState<string | null>(initialFailure);
  const [left, setLeft] = useState(() => Math.max(0, Date.parse(expiresAt) - Date.now()));
  const card = useRef<HTMLInputElement>(null);

  // countdown for the 15-minute stock hold
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Date.parse(expiresAt) - Date.now())), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  useEffect(() => {
    if (left === 0 && phase === 'form') setPhase('expired');
  }, [left, phase]);

  // after a submit: poll until the webhook has updated the payment
  useEffect(() => {
    if (!state.submitted) return;
    setPhase('processing');
    setFailure(null);
    let stop = false;
    const started = Date.now();
    (async () => {
      while (!stop && Date.now() - started < 30_000) {
        await new Promise((r) => setTimeout(r, 1000));
        const res = await fetch(`/shop/api/payments/${paymentId}`, { cache: 'no-store' }).catch(() => null);
        if (!res?.ok) continue;
        const p = (await res.json()) as { status: string; failureReason: string | null; orderId: string };
        if (p.status === 'SUCCEEDED') {
          window.location.assign(`/shop/order/${p.orderId}/thanks`);
          return;
        }
        if (p.status === 'FAILED' || p.status === 'CANCELED' || (p.status === 'REQUIRES_PAYMENT' && p.failureReason)) {
          setFailure(p.failureReason ?? 'The payment did not go through.');
          setPhase(p.status === 'REQUIRES_PAYMENT' ? 'form' : 'failed');
          return;
        }
      }
      if (!stop) {
        setFailure('We have not heard back from the payment provider yet. Check Your Orders in a minute — you will not be charged twice.');
        setPhase('failed');
      }
    })();
    return () => {
      stop = true;
    };
  }, [state.submitted, state.nonce, paymentId]);

  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);

  if (phase === 'processing')
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-10 text-center">
        <span aria-hidden className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--line)] border-t-[var(--accent)]" />
        <p className="text-[18px] font-bold">Processing your payment…</p>
        <p className="text-[13px] text-[var(--muted)]">Waiting for confirmation from agentic pay. Don’t close this page.</p>
      </div>
    );
  if (phase === 'expired')
    return (
      <Notice tone="warning" title="This payment session expired">
        Items were held for 15 minutes and have been released. <a className="text-[var(--link)] underline" href="/shop/cart">Go back to your cart</a> to try again.
      </Notice>
    );
  if (phase === 'failed')
    return (
      <div className="space-y-3">
        <Notice tone="error" title="Payment failed — the order was not placed">
          {failure?.replace(/\.?$/, '.')} Nothing was charged and your items are back in your cart.
        </Notice>
        <p className="flex flex-wrap items-center gap-3 text-[14px]">
          <a className="inline-flex items-center justify-center rounded-full border border-[var(--btn-border)] bg-[var(--btn)] px-4 py-1.5 text-[13px] text-[#0f1111]" href="/shop/cart">
            Return to cart and try again
          </a>
          <a className="text-[var(--link)] underline" href={`/account/orders/${orderId}`}>View the order</a>
        </p>
      </div>
    );

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="idem" value={`${idem}-${state.nonce ?? '0'}`} />
      {(state.error || failure) && (
        <Notice tone="error" title={failure ? 'Your card was declined' : 'Check the card details'}>
          {(state.error ?? failure)?.replace(/\.?$/, '.')} {failure && 'Try another card.'}
        </Notice>
      )}
      <div>
        <p className="mb-1 text-[13px] font-bold">Test cards</p>
        <div className="flex flex-wrap gap-2">
          {CARDS.map((c) => (
            <button
              key={c.number}
              type="button"
              onClick={() => {
                if (card.current) card.current.value = c.number;
              }}
              className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 text-[12px] hover:border-[var(--accent)]"
            >
              <span className="font-mono">{c.number.slice(-4)}</span> · {c.label}
            </button>
          ))}
        </div>
      </div>
      <Field label="Card number">
        <Input ref={card} name="cardNumber" inputMode="numeric" autoComplete="off" placeholder="4242 4242 4242 4242" maxLength={19} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expiry (MM/YY)">
          <Input name="expiry" defaultValue="12/30" autoComplete="off" maxLength={5} required />
        </Field>
        <Field label="CVC">
          <Input name="cvc" defaultValue="123" inputMode="numeric" autoComplete="off" maxLength={4} required />
        </Field>
      </div>
      <Field label="Name on card">
        <Input name="name" autoComplete="off" required />
      </Field>
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
        <SubmitButton disabled={pending} className="px-6 py-2 text-[14px]">
          {pending ? 'Sending…' : `Pay ${amountText}`}
        </SubmitButton>
        <span className="text-[12px] text-[var(--muted)]" aria-live="polite">
          Items held for you: {mm}:{String(ss).padStart(2, '0')}
        </span>
      </div>
    </form>
  );
}
