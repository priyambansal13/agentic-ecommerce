import { fmtMoney, Select, SubmitButton } from '@ac/ui';
import { addToCart } from '../app/cart/actions';

/** Display stock line — inventory's cached view, never used for decisions (checkout reserves for real). */
export function StockLine({ available }: { available: number | undefined }) {
  if (available === undefined) return <p className="text-[var(--status-good)]">In stock</p>;
  if (available <= 0) return <p className="font-bold text-[var(--danger)]">Currently unavailable.</p>;
  if (available <= 5) return <p className="font-bold text-[var(--danger)]">Only {available} left in stock.</p>;
  return <p className="text-[var(--status-good)]">In stock</p>;
}

/** Buy box for one offer: qty + Add to Cart + Buy Now (server action, works without JS). */
export function BuyBox({ offerId, productId, priceMinor, currency, sellerName, available, deliveryText }: { offerId: string; productId: string; priceMinor: number; currency: string; sellerName: string; available: number | undefined; deliveryText: string }) {
  const max = Math.max(0, Math.min(10, available ?? 10));
  return (
    <form action={addToCart} className="space-y-2">
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="productId" value={productId} />
      <p className="text-[24px]">{fmtMoney(priceMinor, currency)}</p>
      <p className="text-[13px]">
        FREE delivery over ₹499 per seller · <b>{deliveryText}</b>
      </p>
      <StockLine available={available} />
      <p>
        Sold by <b>{sellerName}</b>
      </p>
      {max > 0 && (
        <>
          <label className="flex items-center gap-2 text-[13px]">
            Quantity:
            <Select name="qty" defaultValue="1" className="!w-auto">
              {Array.from({ length: max }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </Select>
          </label>
          <SubmitButton name="intent" value="cart" className="w-full">
            Add to Cart
          </SubmitButton>
          <SubmitButton name="intent" value="buy" variant="secondary" className="w-full">
            Buy Now
          </SubmitButton>
        </>
      )}
      <p className="flex items-center gap-1 text-[12px] text-[var(--muted)]">
        <span aria-hidden>🔒</span> Secure transaction · pay on the next step
      </p>
    </form>
  );
}

/** "Other sellers" row: price, seller, stock and a compact Add to Cart. */
export function OfferRow({ offerId, productId, priceMinor, currency, sellerName, available }: { offerId: string; productId: string; priceMinor: number; currency: string; sellerName: string; available: number | undefined }) {
  const out = available !== undefined && available <= 0;
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <b className="tabular-nums">{fmtMoney(priceMinor, currency)}</b>
        <span className="block truncate text-[12px] text-[var(--muted)]">Sold by {sellerName}</span>
        {out ? <span className="block text-[12px] text-[var(--danger)]">Currently unavailable</span> : available !== undefined && available <= 5 && <span className="block text-[12px] text-[var(--danger)]">Only {available} left</span>}
      </span>
      {!out && (
        <form action={addToCart}>
          <input type="hidden" name="offerId" value={offerId} />
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="qty" value="1" />
          <SubmitButton name="intent" value="cart" variant="outline" className="whitespace-nowrap">
            Add to Cart
          </SubmitButton>
        </form>
      )}
    </li>
  );
}
