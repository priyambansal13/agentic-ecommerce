'use client';
import { Field, Input, Select } from '@ac/ui';
import { useState } from 'react';
import { FeePreview } from './fee-preview';

/** Rate-card calculator: pick a category, type a price, see the fees (same preview as when listing). */
export function FeeCalculator({ categories }: { categories: { id: string; name: string }[] }) {
  const [category, setCategory] = useState(categories[0]?.id ?? '');
  const [price, setPrice] = useState('999');
  const n = Number(price.replace(/[,₹\s]/g, ''));
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Selling price (₹)">
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <FeePreview category={category} categoryName={categories.find((c) => c.id === category)?.name} priceMinor={Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined} />
    </div>
  );
}
