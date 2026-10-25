'use client';
import { Field, Input, Notice, Select, SubmitButton } from '@ac/ui';
import { useActionState } from 'react';
import { type CheckoutState, placeOrder } from './actions';

const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal', 'Other'];

/** Client island only to keep typed values and show errors between attempts; the work is a Server Action. */
export function CheckoutForm({ initial, idem, totalMinor, totalText, cartHref }: { initial: Record<string, string>; idem: string; totalMinor: number; totalText: string; cartHref: string }) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(placeOrder, {});
  const v = state.values ?? initial;
  const err = (k: string) => state.issues?.[k];
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="idem" value={state.idem ?? idem} />
      <input type="hidden" name="expectedTotalMinor" value={totalMinor} />
      {state.error && <Rejection state={state} cartHref={cartHref} totalText={totalText} />}
      <fieldset className="space-y-3">
        <legend className="mb-1 text-[18px] font-bold">1. Delivery address</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" error={err('name')}>
            <Input name="name" defaultValue={v.name} autoComplete="name" required />
          </Field>
          <Field label="Mobile number" hint="10 digits, for delivery updates" error={err('phone')}>
            <Input name="phone" defaultValue={v.phone} inputMode="numeric" autoComplete="tel-national" maxLength={10} required />
          </Field>
        </div>
        <Field label="Flat, house no., building, street" error={err('line1')}>
          <Input name="line1" defaultValue={v.line1} autoComplete="address-line1" required />
        </Field>
        <Field label="Area, landmark (optional)" error={err('line2')}>
          <Input name="line2" defaultValue={v.line2} autoComplete="address-line2" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Town / city" error={err('city')}>
            <Input name="city" defaultValue={v.city} autoComplete="address-level2" required />
          </Field>
          <Field label="State" error={err('state')}>
            <Select name="state" defaultValue={v.state || 'Maharashtra'} autoComplete="address-level1">
              {STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="PIN code" error={err('pincode')}>
            <Input name="pincode" defaultValue={v.pincode} inputMode="numeric" autoComplete="postal-code" maxLength={6} required />
          </Field>
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[18px] font-bold">2. Payment method</legend>
        <label className="flex items-start gap-2 rounded-md border border-[var(--accent)] bg-[var(--surface-2)] p-3 text-[14px]">
          <input type="radio" name="provider" value="testpay" defaultChecked className="mt-1" />
          <span>
            <b>Credit or debit card — agentic pay (TEST MODE)</b>
            <span className="block text-[12px] text-[var(--muted)]">You enter a test card on the next step. No real money is charged.</span>
          </span>
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
        <SubmitButton disabled={pending} className="px-6 py-2 text-[14px]">
          {pending ? 'Placing your order…' : 'Place your order and pay'}
        </SubmitButton>
        <p className="text-[14px]">
          Order total: <b className="text-[var(--danger)]">{totalText}</b>
        </p>
      </div>
      <p className="text-[12px] text-[var(--muted)]">By placing your order you agree to the demo conditions of use. Stock is held for you for 15 minutes while you pay.</p>
    </form>
  );
}

function Rejection({ state, cartHref, totalText }: { state: CheckoutState; cartHref: string; totalText: string }) {
  switch (state.code) {
    case 'TOTAL_CHANGED':
      return (
        <Notice tone="warning" title="Your order total changed">
          A price or delivery charge changed since you opened this page. The new total is <b>{totalText}</b> — review it and place the order again.
        </Notice>
      );
    case 'OUT_OF_STOCK':
    case 'OFFER_UNAVAILABLE':
      return (
        <Notice tone="error" title={state.code === 'OUT_OF_STOCK' ? 'Some items just sold out' : 'Some items are no longer available'}>
          {state.error} <a className="text-[var(--link)] underline" href={`${cartHref}?flag=${(state.offerIds ?? []).join(',')}`}>Review your cart</a>
        </Notice>
      );
    case 'RISK_BLOCKED':
      return (
        <Notice tone="error" title="We couldn’t place this order">
          For your security this order needs a check by our team. Nothing was charged. <a className="text-[var(--link)] underline" href="/account/help">Contact Customer Service</a>
        </Notice>
      );
    case 'CART_EMPTY':
      return (
        <Notice tone="info" title="Your cart is empty">
          <a className="text-[var(--link)] underline" href="/shop">Continue shopping</a>
        </Notice>
      );
    case 'AUTH':
      return (
        <Notice tone="warning" title="Please sign in again">
          <a className="text-[var(--link)] underline" href="/api/auth/login?realm=customers&returnTo=/shop/checkout">Sign in</a> — your cart is kept.
        </Notice>
      );
    default:
      return <Notice tone="error">{state.error}</Notice>;
  }
}
