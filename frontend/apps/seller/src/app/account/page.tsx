import { loginUrl } from '@ac/bff';
import { Button, Card, CheckList, fmtDate, Notice, StatusBadge, type Tone } from '@ac/ui';
import { redirect } from 'next/navigation';
import { SellerNav, SellerPage } from '../../lib/nav';
import { isSeller, myAccount, requireCustomer } from '../../lib/seller';

export const dynamic = 'force-dynamic';

const KYC: Record<string, { tone: Tone; label: string; text: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft', text: 'Your application is saved but not submitted yet.' },
  SUBMITTED: { tone: 'warning', label: 'Under review', text: 'Our compliance team is verifying your GST, PAN and bank details — usually within 2 business days.' },
  ACTION_REQUIRED: { tone: 'serious', label: 'Action required', text: 'Compliance asked you to correct some details before they can verify you.' },
  VERIFIED: { tone: 'good', label: 'Verified', text: 'Your business is verified. You can list products and receive payouts.' },
  REJECTED: { tone: 'critical', label: 'Rejected', text: 'We could not verify your business. Contact seller support if you think this is a mistake.' },
};
const STEPS = ['DRAFT', 'SUBMITTED', 'VERIFIED'] as const;

/** Seller account & verification status (user service: GET /sellers/me). */
export default async function SellerAccount({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const session = await requireCustomer('/seller/account');
  const { ok, err } = await searchParams;
  const { account, error } = await myAccount();
  if (account === null) redirect('/register');
  const k = account ? KYC[account.kycStatus] : undefined;
  const reached = account ? (account.kycStatus === 'VERIFIED' ? 2 : account.kycStatus === 'DRAFT' ? 0 : 1) : 0;

  return (
    <div>
      {isSeller(session) && <SellerNav current="/seller/account" name={session.name} />}
      <SellerPage title="Seller account" crumbs={[{ href: '/seller', label: 'Seller Central' }, { label: 'Account' }]}>
        {ok && <Notice tone="success">{ok}</Notice>}
        {err && <Notice tone="error">{err}</Notice>}
        {!account ? (
          <Notice tone="error" title="Seller account unavailable">
            {error}
          </Notice>
        ) : (
          <>
            {account.kycStatus === 'VERIFIED' && !isSeller(session) && (
              <Notice tone="success" title="You are verified — refresh your sign-in to open Seller Central">
                Your seller access was just granted. Sign in again to load it.{' '}
                <a className="font-bold text-[var(--link)] underline" href={loginUrl('customers', '/seller')}>
                  Refresh access and open Seller Central
                </a>
              </Notice>
            )}
            <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
              <Card title="Verification status" actions={k && <StatusBadge tone={k.tone}>{k.label}</StatusBadge>}>
                <ol className="mb-4 flex items-center gap-2 text-[12px]" aria-label="Progress">
                  {STEPS.map((s, i) => (
                    <li key={s} className="flex items-center gap-2">
                      <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full border text-[12px] font-bold ${i <= reached ? 'border-[var(--status-good)] bg-[var(--status-good)] text-white' : 'border-[var(--line)] text-[var(--muted)]'}`}>
                        {i < reached || (i === reached && account.kycStatus === 'VERIFIED') ? '✓' : i + 1}
                      </span>
                      <span className={i <= reached ? 'font-bold' : 'text-[var(--muted)]'}>{['Application', 'Compliance review', 'Verified'][i]}</span>
                      {i < STEPS.length - 1 && <span aria-hidden className="h-px w-8 bg-[var(--line)]" />}
                    </li>
                  ))}
                </ol>
                <p className="text-[14px]">{k?.text}</p>
                {account.decisionNote && (
                  <p className="mt-2 rounded-[var(--radius)] bg-[var(--surface-2)] p-2 text-[13px]">
                    <b>Note from compliance:</b> {account.decisionNote}
                  </p>
                )}
                <p className="mt-2 text-[12px] text-[var(--muted)]">
                  {account.submittedAt ? `Submitted ${fmtDate(account.submittedAt)}` : 'Not submitted yet'}
                  {account.decidedAt ? ` · decided ${fmtDate(account.decidedAt)}` : ''}
                </p>
                <h3 className="mb-1 mt-4 text-[14px] font-bold">Automated checks</h3>
                <CheckList checks={account.checks} />
                {(account.kycStatus === 'DRAFT' || account.kycStatus === 'ACTION_REQUIRED') && (
                  <p className="mt-4">
                    <Button href="/seller/register" variant="primary">
                      {account.kycStatus === 'DRAFT' ? 'Continue application' : 'Fix details and resubmit'}
                    </Button>
                  </p>
                )}
              </Card>
              <Card title="Business details">
                <dl className="space-y-2 text-[13px]">
                  {[
                    ['Store name', account.displayName],
                    ['Legal name', account.legalName],
                    ['Business type', account.businessType.toLowerCase().replace('_', ' ')],
                    ['GSTIN', account.gstin],
                    ['PAN', account.panMasked],
                    ['Address', `${account.address.line1}, ${account.address.city}, ${account.address.state} ${account.address.pincode}`],
                    ['Email', account.contactEmail],
                    ['Payout account', `${account.bank.accountHolder} · ${account.bank.ifsc} · ••••${account.bank.accountLast4}`],
                  ].map(([dt, dd]) => (
                    <div key={dt}>
                      <dt className="text-[var(--muted)]">{dt}</dt>
                      <dd className="break-words">{dd}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-[var(--muted)]">Seller ID</dt>
                    <dd>
                      <code className="break-all text-[12px]">{account.sellerId}</code>
                      <span className="block text-[12px] text-[var(--muted)]">Share this with a brand owner to be authorised as a reseller.</span>
                    </dd>
                  </div>
                </dl>
              </Card>
            </div>
          </>
        )}
      </SellerPage>
    </div>
  );
}
