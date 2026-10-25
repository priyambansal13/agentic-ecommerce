import { load, send } from '@ac/bff';
import { MyBrandsSchema } from '@ac/contracts';
import { Card, CheckList, DataTable, Field, fmtDate, Input, Notice, Select, StatusBadge, SubmitButton, type Tone, Unavailable } from '@ac/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SellerNav, SellerPage } from '../../lib/nav';
import { flash, requireSeller, str } from '../../lib/seller';

export const dynamic = 'force-dynamic';
const APP_TONE: Record<string, Tone> = { SUBMITTED: 'warning', APPROVED: 'good', REJECTED: 'critical' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function applyBrand(fd: FormData) {
  'use server';
  const evidence = str(fd.get('evidenceUrl'));
  const r = await send('POST', '/api/catalog/v1/brands/applications', {
    brandName: str(fd.get('brandName')),
    trademarkNumber: str(fd.get('trademarkNumber')),
    trademarkStatus: str(fd.get('trademarkStatus')),
    relationship: str(fd.get('relationship')),
    ...(evidence ? { evidenceUrl: evidence } : {}),
    restrictResellers: fd.get('restrictResellers') === 'on',
  });
  revalidatePath('/brands');
  redirect(r.ok ? flash('/brands', 'ok', 'Brand application submitted. The brand team checks the trademark with the IP India registry — usually within 5 business days.') : flash('/brands', 'err', r.issues?.[0]?.message ?? r.error));
}

async function setReseller(fd: FormData) {
  'use server';
  const brandId = str(fd.get('brandId'));
  const sellerId = str(fd.get('sellerId'));
  const remove = fd.get('op') === 'remove';
  if (!UUID.test(sellerId)) redirect(flash('/brands', 'err', 'Enter the reseller’s seller ID (shown on their Seller account page).'));
  const r = await send(remove ? 'DELETE' : 'PUT', `/api/catalog/v1/brands/${brandId}/resellers/${sellerId}`);
  revalidatePath('/brands');
  redirect(r.ok ? flash('/brands', 'ok', remove ? 'Reseller removed — their offers for this brand are deactivated.' : 'Reseller authorised.') : flash('/brands', 'err', r.error));
}

/** Brand Registry (catalog service): brands I own + authorised resellers, brands I may resell, my applications. */
export default async function Brands({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const session = await requireSeller('/seller/brands');
  const { ok, err } = await searchParams;
  const mine = await load(MyBrandsSchema, '/api/catalog/v1/brands/mine');
  return (
    <div>
      <SellerNav current="/seller/brands" name={session.name} />
      <SellerPage
        title="Brand Registry"
        crumbs={[{ href: '/seller', label: 'Seller Central' }, { label: 'Brands' }]}
        intro="Own a registered or pending trademark? Enrol your brand to control its product pages and choose who may resell it. Manufacturers and authorised agents can enrol with the owner’s proof."
      >
        {ok && <Notice tone="success">{ok}</Notice>}
        {err && <Notice tone="error">{err}</Notice>}
        {!mine.ok && <Unavailable what="Brand Registry" reason={mine.error} />}
        {mine.ok && (
          <>
            <Card title={`Your brands (${mine.data.owned.length})`}>
              {mine.data.owned.length === 0 ? (
                <p className="text-[14px] text-[var(--muted)]">You do not own a registered brand yet. Apply below.</p>
              ) : (
                <div className="space-y-4">
                  {mine.data.owned.map((b) => (
                    <div key={b.brandId} className="rounded-[var(--radius)] border border-[var(--line)] p-3">
                      <p className="flex flex-wrap items-center gap-2">
                        <b className="text-[16px]">{b.name}</b>
                        <StatusBadge tone="good">Brand Registry</StatusBadge>
                        <StatusBadge tone={b.restricted ? 'warning' : 'neutral'}>{b.restricted ? 'Resellers by authorisation only' : 'Open to all resellers'}</StatusBadge>
                      </p>
                      <h3 className="mb-1 mt-3 text-[13px] font-bold">Authorised resellers ({b.resellers.length})</h3>
                      <DataTable
                        caption={`Authorised resellers of ${b.name}`}
                        empty="No resellers authorised — only you can sell this brand."
                        rows={b.resellers}
                        columns={[
                          { key: 'n', label: 'Seller', render: (r) => r.sellerName },
                          { key: 'id', label: 'Seller ID', render: (r) => <code className="text-[11px]">{r.sellerId}</code> },
                          { key: 'at', label: 'Since', render: (r) => fmtDate(r.authorizedAt) },
                          {
                            key: 'x',
                            label: '',
                            align: 'right',
                            render: (r) => (
                              <form action={setReseller}>
                                <input type="hidden" name="brandId" value={b.brandId} />
                                <input type="hidden" name="sellerId" value={r.sellerId} />
                                <input type="hidden" name="op" value="remove" />
                                <SubmitButton variant="danger">Remove</SubmitButton>
                              </form>
                            ),
                          },
                        ]}
                      />
                      <form action={setReseller} className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="brandId" value={b.brandId} />
                        <Field label="Authorise a reseller" hint="Their seller ID (on their Seller account page)" className="min-w-[20rem] flex-1">
                          <Input name="sellerId" required pattern={UUID.source} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellCheck={false} />
                        </Field>
                        <SubmitButton variant="secondary">Authorise</SubmitButton>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Brands you may resell">
                {mine.data.authorizedFor.length === 0 ? (
                  <p className="text-[14px] text-[var(--muted)]">No authorisations. To resell a protected brand, ask its owner to authorise your seller ID.</p>
                ) : (
                  <ul className="divide-y divide-[var(--line)] text-[14px]">
                    {mine.data.authorizedFor.map((b) => (
                      <li key={b.brandId} className="flex justify-between py-2">
                        <b>{b.name}</b>
                        <span className="text-[12px] text-[var(--muted)]">owner: {b.ownerName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Enrol a brand">
                <form action={applyBrand} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Brand name" hint="Exactly as on the trademark">
                      <Input name="brandName" required minLength={2} maxLength={60} />
                    </Field>
                    <Field label="Trademark application no." hint="IP India, 6–8 digits">
                      <Input name="trademarkNumber" required inputMode="numeric" pattern="\d{6,8}" />
                    </Field>
                    <Field label="Trademark status">
                      <Select name="trademarkStatus" defaultValue="REGISTERED">
                        <option value="REGISTERED">Registered</option>
                        <option value="PENDING">Pending (filed)</option>
                      </Select>
                    </Field>
                    <Field label="Your relationship to the brand">
                      <Select name="relationship" defaultValue="OWNER">
                        <option value="OWNER">Brand owner</option>
                        <option value="MANUFACTURER">Manufacturer</option>
                        <option value="AUTHORIZED_AGENT">Authorised agent</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Evidence link (optional)" hint="Trademark certificate or IP India record URL">
                    <Input name="evidenceUrl" type="url" placeholder="https://" />
                  </Field>
                  <label className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" name="restrictResellers" defaultChecked /> Only resellers I authorise may sell this brand
                  </label>
                  <SubmitButton>Submit for Brand Registry</SubmitButton>
                </form>
              </Card>
            </div>

            <Card title="Your applications">
              {mine.data.applications.length === 0 ? (
                <p className="text-[14px] text-[var(--muted)]">No applications yet.</p>
              ) : (
                <div className="space-y-3">
                  {mine.data.applications.map((a) => (
                    <div key={a.applicationId} className="rounded-[var(--radius)] border border-[var(--line)] p-3 text-[14px]">
                      <p className="flex flex-wrap items-center gap-2">
                        <b>{a.brandName}</b>
                        <StatusBadge tone={APP_TONE[a.status] ?? 'neutral'}>{a.status === 'SUBMITTED' ? 'Under review' : a.status.toLowerCase()}</StatusBadge>
                        <span className="text-[12px] text-[var(--muted)]">
                          TM {a.trademarkNumber} ({a.trademarkStatus.toLowerCase()}) · submitted {fmtDate(a.submittedAt)}
                          {a.decidedAt ? ` · decided ${fmtDate(a.decidedAt)}` : ''}
                        </span>
                      </p>
                      {a.note && <p className="mt-1 text-[13px]">Brand team: {a.note}</p>}
                      <div className="mt-2">
                        <CheckList checks={a.checks} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </SellerPage>
    </div>
  );
}
