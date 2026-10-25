'use server';
import { send } from '@ac/bff';
import { OfferInputSchema, ProductInputSchema } from '@ac/contracts';
import { redirect } from 'next/navigation';
import { imageFiles, uploadImages } from '../../lib/images';
import { actionUrl, toMinor } from '../../lib/seller';

export interface ListingState {
  error?: string;
  /** 422 ListingRejection code → friendly help in the form */
  code?: string;
  issues?: Record<string, string>;
  values?: Record<string, string>;
}

const PATHS: Record<string, string> = { 'offer.sellerSku': 'sellerSku', 'offer.priceMinor': 'price', 'offer.mrpMinor': 'mrp', 'offer.quantity': 'quantity', priceMinor: 'price', mrpMinor: 'mrp' };
const byField = (issues: { path: PropertyKey[]; message: string }[]) => {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const p = i.path.map(String).join('.');
    const k = PATHS[p] ?? (p.startsWith('bullets') ? 'bullets' : p);
    out[k] ??= i.message;
  }
  return out;
};
const vals = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? '').trim()]));
const offerPart = (v: Record<string, string>) => {
  const mrp = toMinor(v.mrp);
  return { sellerSku: v.sellerSku, priceMinor: toMinor(v.price), ...(mrp ? { mrpMinor: mrp } : {}), quantity: v.quantity === '' ? undefined : Number(v.quantity) };
};
const priceAboveMrp = (o: { priceMinor?: number; mrpMinor?: number }) => !!o.priceMinor && !!o.mrpMinor && o.priceMinor > o.mrpMinor;

/** Create a NEW product page in the shared catalogue + this seller’s first offer (goes to moderation). */
export async function createProduct(_: ListingState, fd: FormData): Promise<ListingState> {
  const v = vals(fd, ['title', 'brand', 'category', 'description', 'bullets', 'sellerSku', 'price', 'mrp', 'quantity']);
  const input = {
    title: v.title,
    brand: v.brand,
    category: v.category,
    description: v.description,
    bullets: v.bullets.split('\n').map((b) => b.trim()).filter(Boolean),
    offer: offerPart(v),
  };
  if (priceAboveMrp(input.offer)) return { code: 'PRICE_ABOVE_MRP', issues: { price: 'Price cannot be above MRP' }, values: v };
  const parsed = ProductInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'Please correct the highlighted fields.', issues: byField(parsed.error.issues), values: v };
  const files = imageFiles(fd);
  const r = await send('POST', '/api/catalog/v1/products', parsed.data, { idempotencyKey: String(fd.get('idem') ?? '') || undefined });
  if (!r.ok) return { error: r.code ? undefined : r.error, code: r.code, issues: r.issues ? byField(r.issues) : undefined, values: v };
  const productId = (r.data as { productId?: string } | undefined)?.productId;
  const done = `“${parsed.data.title}” submitted. It goes live after moderation — usually within a few hours.`;
  if (productId && files.length) {
    const failed = await uploadImages(productId, files);
    if (failed.length) redirect(`${actionUrl('')}/listings/${productId}/images?err=${encodeURIComponent(`${done} Some photos were not added — ${failed.join(' · ')}`)}`);
  }
  redirect(`${actionUrl('')}/listings?ok=${encodeURIComponent(files.length ? `${done} ${files.length} photo${files.length > 1 ? 's' : ''} added.` : done)}`);
}

/** Add this seller’s offer to an EXISTING published product. */
export async function createOffer(_: ListingState, fd: FormData): Promise<ListingState> {
  const v = vals(fd, ['productId', 'sellerSku', 'price', 'mrp', 'quantity']);
  const input = { productId: v.productId, ...offerPart(v) };
  if (priceAboveMrp(input)) return { code: 'PRICE_ABOVE_MRP', issues: { price: 'Price cannot be above MRP' }, values: v };
  const parsed = OfferInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'Please correct the highlighted fields.', issues: byField(parsed.error.issues), values: v };
  const r = await send('POST', '/api/catalog/v1/offers', parsed.data, { idempotencyKey: String(fd.get('idem') ?? '') || undefined });
  if (!r.ok) return { error: r.code ? undefined : r.error, code: r.code, issues: r.issues ? byField(r.issues) : undefined, values: v };
  redirect(`${actionUrl('')}/listings?ok=${encodeURIComponent('Your offer is live on the product page.')}`);
}

