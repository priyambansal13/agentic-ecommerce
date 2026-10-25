'use client';
import { Field, Input, Notice, Select, SubmitButton } from '@ac/ui';
import { useActionState } from 'react';
import { type FormState, saveApplication } from './actions';

const TYPES = [
  ['MANUFACTURER', 'Manufacturer — I make the products'],
  ['BRAND_OWNER', 'Brand owner — I own the brand / trademark'],
  ['DISTRIBUTOR', 'Distributor / wholesaler'],
  ['RETAILER', 'Retailer / reseller'],
] as const;
const STATES = ['Andhra Pradesh', 'Delhi', 'Gujarat', 'Haryana', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal', 'Other'];

/** Seller application (client island only for keeping typed values and field errors between submits). */
export function ApplicationForm({ initial, editingExisting }: { initial: Record<string, string>; editingExisting: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveApplication, {});
  // React resets the form after each action; inputs then fall back to these defaults (typed values or saved draft)
  const v = state.values ?? initial;
  const err = (k: string) => state.issues?.[k];
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && (
        <Notice tone="error">
          {state.error}
        </Notice>
      )}
      <fieldset className="space-y-3">
        <legend className="mb-1 text-[18px] font-bold">1. Business information</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Legal business name" hint="As on your GST certificate" error={err('legalName')}>
            <Input name="legalName" defaultValue={v.legalName} autoComplete="organization" required />
          </Field>
          <Field label="Store display name" hint="What buyers see: “Sold by …”" error={err('displayName')}>
            <Input name="displayName" defaultValue={v.displayName} required />
          </Field>
        </div>
        <Field label="Business type" error={err('businessType')}>
          <Select name="businessType" defaultValue={v.businessType || 'RETAILER'}>
            {TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-[18px] font-bold">2. Tax details</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GSTIN" hint="15 characters, e.g. 27ABCDE1234F1Z5" error={err('gstin')}>
            <Input name="gstin" defaultValue={v.gstin} maxLength={15} className="uppercase" spellCheck={false} required />
          </Field>
          <Field label="PAN" hint={editingExisting ? 'Re-enter your PAN (we only show it masked)' : '10 characters, e.g. ABCDE1234F — must match the PAN inside your GSTIN'} error={err('pan')}>
            <Input name="pan" defaultValue={v.pan} maxLength={10} className="uppercase" spellCheck={false} autoComplete="off" required />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-[18px] font-bold">3. Registered address</legend>
        <Field label="Address" error={err('line1')}>
          <Input name="line1" defaultValue={v.line1} autoComplete="street-address" required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="City" error={err('city')}>
            <Input name="city" defaultValue={v.city} autoComplete="address-level2" required />
          </Field>
          <Field label="State" error={err('state')}>
            <Select name="state" defaultValue={v.state || 'Maharashtra'}>
              {STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="PIN code" error={err('pincode')}>
            <Input name="pincode" defaultValue={v.pincode} inputMode="numeric" maxLength={6} autoComplete="postal-code" required />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-[18px] font-bold">4. Contact</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email" error={err('contactEmail')}>
            <Input name="contactEmail" type="email" defaultValue={v.contactEmail} autoComplete="email" required />
          </Field>
          <Field label="Mobile number" hint="10 digits" error={err('contactPhone')}>
            <Input name="contactPhone" type="tel" defaultValue={v.contactPhone} inputMode="tel" autoComplete="tel-national" required />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-[18px] font-bold">5. Bank account for payouts</legend>
        <p className="text-[12px] text-[var(--muted)]">The account holder name must match your legal business name. We pay out every 7 days after the return window closes.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Account holder name" error={err('accountHolder')}>
            <Input name="accountHolder" defaultValue={v.accountHolder} required />
          </Field>
          <Field label="IFSC" hint="e.g. HDFC0001234" error={err('ifsc')}>
            <Input name="ifsc" defaultValue={v.ifsc} maxLength={11} className="uppercase" spellCheck={false} required />
          </Field>
          <Field label="Account number" hint={editingExisting ? 'Re-enter (we only show the last 4 digits)' : '9–18 digits'} error={err('accountNumber')}>
            <Input name="accountNumber" defaultValue={v.accountNumber} inputMode="numeric" autoComplete="off" required />
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
        <SubmitButton name="intent" value="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Submit for verification'}
        </SubmitButton>
        <SubmitButton name="intent" value="save" variant="outline" disabled={pending}>
          Save as draft
        </SubmitButton>
        <span className="text-[12px] text-[var(--muted)]">By submitting you confirm the details are correct. They are checked against GST and PAN records by our compliance team.</span>
      </div>
    </form>
  );
}
