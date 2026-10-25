'use client';
import { Field, Input, Select, SubmitButton, Textarea } from '@ac/ui';
import { useActionState, useState } from 'react';
import { createOffer, createProduct, type ListingState } from '../app/listings/actions';
import { ImagePicker } from './image-picker';
import { FeePreview } from './fee-preview';
import { ListingError } from './listing-help';

type Cat = { id: string; name: string; gated: boolean; requirement: string | null; allowed: boolean };
const minor = (rupees: string) => {
  const n = Number(rupees.replace(/[,₹\s]/g, ''));
  return rupees.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
};

function OfferFields({ v, err, price, setPrice }: { v: Record<string, string>; err: (k: string) => string | undefined; price: string; setPrice: (s: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Your SKU" hint="Your own stock-keeping code" error={err('sellerSku')}>
        <Input name="sellerSku" defaultValue={v.sellerSku} required maxLength={40} spellCheck={false} />
      </Field>
      <Field label="Quantity in stock" error={err('quantity')}>
        <Input name="quantity" type="number" min={0} max={100000} defaultValue={v.quantity || '10'} required />
      </Field>
      <Field label="Your price (₹)" hint="Including GST on the product" error={err('price')}>
        <Input id="price" name="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
      </Field>
      <Field label="MRP (₹, optional)" hint="Maximum retail price printed on the pack" error={err('mrp')}>
        <Input name="mrp" inputMode="decimal" defaultValue={v.mrp} />
      </Field>
    </div>
  );
}

/** Add a product: new page in the shared catalogue + first offer, with a live fee preview. */
export function ProductForm({ categories, idem }: { categories: Cat[]; idem: string }) {
  const [state, action, pending] = useActionState<ListingState, FormData>(createProduct, {});
  const v = state.values ?? {};
  const err = (k: string) => state.issues?.[k];
  const [category, setCategory] = useState(v.category || categories.find((c) => c.allowed)?.id || categories[0]?.id || '');
  const [price, setPrice] = useState(v.price ?? '');
  const cat = categories.find((c) => c.id === category);
  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[1fr_20rem]" noValidate>
      <input type="hidden" name="idem" value={idem} />
      <div className="space-y-4">
        <ListingError code={state.code} error={state.error} />
        <fieldset className="space-y-3">
          <legend className="mb-1 text-[18px] font-bold">Product identity</legend>
          <Field label="Product title" hint="Brand + model + key attribute, e.g. “Nova Audio X200 wireless headphones, black”" error={err('title')}>
            <Input name="title" defaultValue={v.title} required minLength={5} maxLength={150} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Brand" hint="Use “Generic” for unbranded products" error={err('brand')}>
              <Input name="brand" defaultValue={v.brand} required maxLength={60} />
            </Field>
            <Field label="Category" error={err('category')} hint={cat?.gated ? (cat.allowed ? 'Gated — you are approved' : `Gated — needs approval: ${cat.requirement ?? ''}`) : 'Open to all verified sellers'}>
              <Select name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.gated ? (c.allowed ? ' (approved)' : ' (approval required)') : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="mb-1 text-[18px] font-bold">Description</legend>
          <Field label="Key features" hint="One per line, up to 5 bullet points" error={err('bullets')}>
            <Textarea name="bullets" rows={4} defaultValue={v.bullets} />
          </Field>
          <Field label="Product description" hint="At least 20 characters. No prices, offers or contact details." error={err('description')}>
            <Textarea name="description" rows={5} defaultValue={v.description} />
          </Field>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="mb-1 text-[18px] font-bold">Photos</legend>
          <ImagePicker />
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="mb-1 text-[18px] font-bold">Your offer</legend>
          <OfferFields v={v} err={err} price={price} setPrice={setPrice} />
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
          <SubmitButton disabled={pending}>{pending ? 'Submitting…' : 'Submit for review'}</SubmitButton>
          <span className="text-[12px] text-[var(--muted)]">New product pages are checked by our moderation agent and, when needed, a moderator before going live.</span>
        </div>
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <FeePreview category={category} categoryName={cat?.name} priceMinor={minor(price)} />
      </div>
    </form>
  );
}

/** Sell an existing product: just the offer, with a live fee preview. */
export function OfferForm({ productId, category, categoryName, idem }: { productId: string; category: string; categoryName: string; idem: string }) {
  const [state, action, pending] = useActionState<ListingState, FormData>(createOffer, {});
  const v = state.values ?? {};
  const err = (k: string) => state.issues?.[k];
  const [price, setPrice] = useState(v.price ?? '');
  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[1fr_20rem]" noValidate>
      <input type="hidden" name="idem" value={idem} />
      <input type="hidden" name="productId" value={productId} />
      <div className="space-y-4">
        <ListingError code={state.code} error={state.error} />
        <OfferFields v={v} err={err} price={price} setPrice={setPrice} />
        <SubmitButton disabled={pending}>{pending ? 'Saving…' : 'Start selling'}</SubmitButton>
      </div>
      <FeePreview category={category} categoryName={categoryName} priceMinor={minor(price)} />
    </form>
  );
}

