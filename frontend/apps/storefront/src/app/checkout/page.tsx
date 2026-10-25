import { loadCart, unseal } from '@ac/bff';
import { type Address, CartSchema, productImageUrl } from '@ac/contracts';
import { Button, EmptyState, fmtMoney, Glyph, Notice, ProductImage } from '@ac/ui';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { ADDRESS_COOKIE, deliveryWindow, requireBuyer } from '../../lib/shop';
import { CheckoutForm } from './checkout-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout · agentic.commerce' };

/** Checkout: delivery address + order summary per seller → POST /checkout (order saga) → pay page. */
export default async function CheckoutPage() {
  const session = await requireBuyer('/shop/checkout');
  const cart = await loadCart(CartSchema, 6000);
  if (!cart.ok && cart.status !== 204)
    return (
      <main className="mx-auto max-w-[1100px] px-4 py-6">
        <Notice tone="error" title="Checkout is unavailable right now">
          {cart.error} Nothing was charged. <a className="text-[var(--link)] underline" href="/shop/cart">Back to cart</a>
        </Notice>
      </main>
    );
  const c = cart.ok ? cart.data : null;
  if (!c || c.lines.length === 0)
    return (
      <main className="mx-auto max-w-[1100px] px-4 py-6">
        <EmptyState icon={Glyph.cart} title="Your cart is empty" text="Add something to your cart to check out." action={<Button href="/shop" variant="primary">Continue shopping</Button>} />
      </main>
    );
  const saved = await unseal<Address>((await cookies()).get(ADDRESS_COOKIE)?.value);
  const initial: Record<string, string> = { name: saved?.name ?? session.name, line1: saved?.line1 ?? '', line2: saved?.line2 ?? '', city: saved?.city ?? '', state: saved?.state ?? '', pincode: saved?.pincode ?? '', phone: saved?.phone ?? '' };
  const sellers = [...new Set(c.lines.map((l) => l.sellerId))];
  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-4">
      <header className="flex items-center justify-between border-b border-[var(--line)] pb-3">
        <h1 className="text-[28px]">Checkout</h1>
        <span className="flex items-center gap-1 text-[13px] text-[var(--muted)]">
          <span aria-hidden>🔒</span> Secure checkout
        </span>
      </header>
      {!c.canCheckout && (
        <Notice tone="error" title="Some items need your attention">
          <a className="text-[var(--link)] underline" href="/shop/cart">Review your cart</a> before placing the order.
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className="rounded-[var(--radius)] bg-[var(--card)] p-5">
          <CheckoutForm initial={initial} idem={randomUUID()} totalMinor={c.totalMinor} totalText={fmtMoney(c.totalMinor, c.currency)} cartHref="/shop/cart" />
        </section>
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <section className="space-y-2 rounded-[var(--radius)] bg-[var(--card)] p-4 text-[14px]">
            <h2 className="text-[18px] font-bold">Order summary</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1">
              <dt>Items ({c.itemCount}):</dt>
              <dd className="text-right tabular-nums">{fmtMoney(c.subtotalMinor, c.currency)}</dd>
              <dt>Delivery:</dt>
              <dd className="text-right tabular-nums">{c.shippingMinor ? fmtMoney(c.shippingMinor, c.currency) : 'FREE'}</dd>
              <dt className="border-t border-[var(--line)] pt-2 text-[18px] font-bold text-[var(--danger)]">Order total:</dt>
              <dd className="border-t border-[var(--line)] pt-2 text-right text-[18px] font-bold tabular-nums text-[var(--danger)]">{fmtMoney(c.totalMinor, c.currency)}</dd>
            </dl>
            <p className="text-[12px] text-[var(--muted)]">Prices include GST. Delivered by {sellers.length} seller{sellers.length === 1 ? '' : 's'}.</p>
          </section>
          {sellers.map((sid) => {
            const lines = c.lines.filter((l) => l.sellerId === sid);
            const sub = lines.reduce((a, l) => a + l.lineTotalMinor, 0);
            return (
              <section key={sid} className="space-y-2 rounded-[var(--radius)] bg-[var(--card)] p-4 text-[13px]">
                <p className="font-bold text-[var(--success)]">Arriving {deliveryWindow()}</p>
                <p className="text-[12px] text-[var(--muted)]">
                  Sold by {lines[0].sellerName} · {sub >= c.freeShippingOverMinor ? 'FREE delivery' : 'delivery charge applies'}
                </p>
                <ul className="space-y-2">
                  {lines.map((l) => (
                    <li key={l.offerId} className="flex items-center gap-2">
                      <ProductImage src={productImageUrl(l.productId, 'thumb')} category={l.category} title={l.title} box={48} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2">{l.title}</span>
                        <span className="text-[12px] text-[var(--muted)]">
                          Qty {l.qty} · {fmtMoney(l.lineTotalMinor, c.currency)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </aside>
      </div>
    </main>
  );
}
