import { Card, Notice, TextLink } from '@ac/ui';
import { redirect } from 'next/navigation';
import { SellerPage } from '../../lib/nav';
import { myAccount, requireCustomer } from '../../lib/seller';
import { ApplicationForm } from './application-form';

export const dynamic = 'force-dynamic';

const STEPS = [
  { n: 1, t: 'Register your business', d: 'GSTIN, PAN, address and the bank account for payouts.' },
  { n: 2, t: 'Get verified', d: 'Our compliance team checks your GST, PAN and bank details (usually 2 business days).' },
  { n: 3, t: 'List products', d: 'Add your offer to an existing product or create a new product page. Gated categories need approval.' },
  { n: 4, t: 'Protect your brand', d: 'Own a trademark? Enrol it in Brand Registry to control the product pages and who may resell it.' },
];

/** “Sell on agentic.commerce” — any signed-in customer can apply; user service owns the application (KYC). */
export default async function Register() {
  const session = await requireCustomer('/seller/register');
  const { account, error } = await myAccount();
  if (account && (account.kycStatus === 'SUBMITTED' || account.kycStatus === 'VERIFIED' || account.kycStatus === 'REJECTED')) redirect('/account');

  const initial: Record<string, string> = account
    ? {
        legalName: account.legalName,
        displayName: account.displayName,
        businessType: account.businessType,
        gstin: account.gstin,
        pan: '',
        line1: account.address.line1,
        city: account.address.city,
        state: account.address.state,
        pincode: account.address.pincode,
        contactEmail: account.contactEmail,
        contactPhone: '',
        accountHolder: account.bank.accountHolder,
        ifsc: account.bank.ifsc,
        accountNumber: '',
      }
    : { contactEmail: session.email ?? '', legalName: '', displayName: '' };

  return (
    <div>
      <section className="bg-[var(--nav-2)] px-4 py-8 text-[var(--nav-fg)]">
        <div className="mx-auto max-w-[1200px]">
          <p className="text-[13px] text-[var(--accent)]">agentic.commerce · Sell</p>
          <h1 className="text-[34px] font-bold leading-tight">Sell on agentic.commerce</h1>
          <p className="max-w-[44rem] text-[16px] text-[var(--nav-muted)]">Reach crores of customers across India. Register as a company, manufacturer, brand owner or reseller — one product page per product, many sellers competing on price and service.</p>
          <p className="mt-3 text-[14px]">
            Fees: a <b>referral fee</b> by category (5–17%), a small <b>closing fee</b> by price band, a <b>payment-collection fee</b>, plus 18% GST on fees.{' '}
            <a href="/seller/fees" className="text-[var(--accent)] underline">
              See the rate card and calculator
            </a>
          </p>
        </div>
      </section>
      <SellerPage title={account ? 'Continue your application' : 'Register as a seller'} intro={`Signed in as ${session.name}. Takes about 10 minutes — keep your GST certificate, PAN card and a cancelled cheque handy.`}>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-3 text-[13px]">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] font-bold text-[#0f1111]">{s.n}</span>
              <b>{s.t}</b>
              <p className="mt-1 text-[var(--muted)]">{s.d}</p>
            </li>
          ))}
        </ol>
        {error && <Notice tone="error" title="We could not load your application">{error} — you can still fill in the form.</Notice>}
        {account?.kycStatus === 'ACTION_REQUIRED' && (
          <Notice tone="warning" title="Our compliance team asked for changes">
            {account.decisionNote || 'Please review your details.'} Fix the details below and submit again. <TextLink href="/seller/account">View the checks</TextLink>
          </Notice>
        )}
        <Card>
          <ApplicationForm initial={initial} editingExisting={!!account} />
        </Card>
      </SellerPage>
    </div>
  );
}
