import { load, send } from '@ac/bff';
import { SellerCategoriesSchema } from '@ac/contracts';
import { Card, DataTable, Field, Input, Notice, StatusBadge, SubmitButton, type Tone, Unavailable } from '@ac/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SellerNav, SellerPage } from '../../lib/nav';
import { flash, requireSeller, str } from '../../lib/seller';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: Tone; label: string }> = {
  NOT_REQUIRED: { tone: 'good', label: 'Open to all sellers' },
  NOT_REQUESTED: { tone: 'neutral', label: 'Approval required' },
  PENDING: { tone: 'warning', label: 'Under review' },
  APPROVED: { tone: 'good', label: 'Approved' },
  REJECTED: { tone: 'critical', label: 'Rejected' },
};

async function requestApproval(fd: FormData) {
  'use server';
  const category = str(fd.get('category'));
  const r = await send('POST', `/api/user/v1/sellers/me/categories/${encodeURIComponent(category)}`, { licenseNumber: str(fd.get('licenseNumber')) });
  revalidatePath('/categories');
  redirect(r.ok ? flash('/categories', 'ok', `Approval requested for ${category}. The category team usually decides within 2 business days.`) : flash('/categories', 'err', r.issues?.[0]?.message ?? r.error));
}

/** Category approvals (user service). Gated categories (e.g. grocery — FSSAI licence) need the category team's approval. */
export default async function Categories({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const session = await requireSeller('/seller/categories');
  const { ok, err } = await searchParams;
  const cats = await load(SellerCategoriesSchema, '/api/user/v1/sellers/me/categories');
  return (
    <div>
      <SellerNav current="/seller/categories" name={session.name} />
      <SellerPage title="Category approvals" crumbs={[{ href: '/seller', label: 'Seller Central' }, { label: 'Categories' }]} intro="Most categories are open to every verified seller. Gated categories protect buyers (food safety, electrical safety, authenticity) and need approval first.">
        {ok && <Notice tone="success">{ok}</Notice>}
        {err && <Notice tone="error">{err}</Notice>}
        {cats.ok ? (
          <Card>
            <DataTable
              caption="Categories"
              rows={cats.data.categories}
              columns={[
                { key: 'name', label: 'Category', render: (c) => <b>{c.name}</b> },
                { key: 'req', label: 'Requirement', render: (c) => (c.gated ? <span className="text-[13px]">{c.requirement}</span> : <span className="text-[13px] text-[var(--muted)]">none</span>) },
                {
                  key: 'st',
                  label: 'Status',
                  render: (c) => (
                    <span className="space-y-1">
                      <StatusBadge tone={STATUS[c.status]?.tone ?? 'neutral'}>{STATUS[c.status]?.label ?? c.status}</StatusBadge>
                      {c.licenseNumber && <span className="block text-[12px] text-[var(--muted)]">licence {c.licenseNumber}</span>}
                      {c.note && <span className="block text-[12px]">{c.note}</span>}
                    </span>
                  ),
                },
                {
                  key: 'act',
                  label: 'Action',
                  render: (c) =>
                    c.status === 'NOT_REQUESTED' || c.status === 'REJECTED' ? (
                      <form action={requestApproval} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="category" value={c.category} />
                        <Field label="Licence / certificate no." className="min-w-[12rem]">
                          <Input name="licenseNumber" required minLength={5} maxLength={40} placeholder={c.category === 'grocery' ? 'FSSAI 14-digit licence' : 'certificate number'} />
                        </Field>
                        <SubmitButton>{c.status === 'REJECTED' ? 'Request again' : 'Request approval'}</SubmitButton>
                      </form>
                    ) : (
                      <span className="text-[12px] text-[var(--muted)]">—</span>
                    ),
                },
              ]}
            />
          </Card>
        ) : (
          <Unavailable what="Category approvals" reason={cats.error} />
        )}
      </SellerPage>
    </div>
  );
}
