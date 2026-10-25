'use server';
import { send } from '@ac/bff';
import { SellerApplicationInputSchema } from '@ac/contracts';
import { redirect } from 'next/navigation';
import { actionUrl } from '../../lib/seller';

export interface FormState {
  error?: string;
  issues?: Record<string, string>;
  values?: Record<string, string>;
}

const FIELDS = ['legalName', 'displayName', 'businessType', 'gstin', 'pan', 'line1', 'city', 'state', 'pincode', 'contactEmail', 'contactPhone', 'accountHolder', 'ifsc', 'accountNumber'] as const;
/** form field name ← contract path */
const PATH_TO_FIELD: Record<string, string> = { 'address.line1': 'line1', 'address.city': 'city', 'address.state': 'state', 'address.pincode': 'pincode', 'bank.accountHolder': 'accountHolder', 'bank.ifsc': 'ifsc', 'bank.accountNumber': 'accountNumber' };

const issuesByField = (issues: { path: PropertyKey[]; message: string }[]) => {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const p = i.path.map(String).join('.');
    out[PATH_TO_FIELD[p] ?? p] ??= i.message;
  }
  return out;
};

/** Save the application as a draft, or save and submit it for KYC verification (user service). */
export async function saveApplication(_: FormState, fd: FormData): Promise<FormState> {
  const v = Object.fromEntries(FIELDS.map((f) => [f, String(fd.get(f) ?? '').trim()])) as Record<(typeof FIELDS)[number], string>;
  const values = { ...v, accountNumber: '', pan: '' }; // never echo secrets back into the page
  const input = {
    legalName: v.legalName,
    displayName: v.displayName,
    businessType: v.businessType,
    gstin: v.gstin,
    pan: v.pan,
    address: { line1: v.line1, city: v.city, state: v.state, pincode: v.pincode },
    contactEmail: v.contactEmail,
    contactPhone: v.contactPhone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''),
    bank: { accountHolder: v.accountHolder, ifsc: v.ifsc, accountNumber: v.accountNumber.replace(/\s/g, '') },
  };
  const parsed = SellerApplicationInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'Please correct the highlighted fields.', issues: issuesByField(parsed.error.issues), values };

  const saved = await send('PUT', '/api/user/v1/sellers/me', parsed.data);
  if (!saved.ok) return { error: saved.error, issues: saved.issues ? issuesByField(saved.issues) : undefined, values };
  if (fd.get('intent') === 'submit') {
    const sub = await send('POST', '/api/user/v1/sellers/me/submit');
    if (!sub.ok) return { error: `Saved as a draft, but submitting failed: ${sub.error}`, values };
    redirect(`${actionUrl('')}/account?ok=${encodeURIComponent('Application submitted. Our compliance team will verify your details — usually within 2 business days.')}`);
  }
  redirect(`${actionUrl('')}/account?ok=${encodeURIComponent('Draft saved. Submit it when you are ready.')}`);
}
