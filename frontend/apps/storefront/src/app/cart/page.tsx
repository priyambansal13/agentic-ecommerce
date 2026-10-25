import { cartSessionId, getSession, loadCart, loadPublic } from '@ac/bff';
import { CartSchema, type CartLine, ProductSearchSchema, productImageUrl } from '@ac/contracts';
import { Button, EmptyState, fmtMoney, Glyph, Notice, ProductCard, ProductImage, Shelf, StatusBadge, TextLink } from '@ac/ui';
import { redirect } from 'next/navigation';
import { QtySelect } from '../../components/qty-select';
import { shopUrl } from '../../lib/shop';
import { setQty } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shopping Cart · agentic.commerce' };

const STATUS: Record<CartLine['status'], { tone: 'warning' | 'critical'; text: (l: CartLine, c: string) => string } | undefined> = {
  OK: undefined,
  PRICE_CHANGED: { tone: 'warning', text: (l, c) => `Price changed from ${fmtMoney(l.addedPriceMinor, c)} to ${fmtMoney(l.unitPriceMinor, c)}` },
  LOW_STOCK: { tone: 'warning', text: (l) => `Only ${l.available} left — reduce the quantity to continue` },
  OUT_OF_STOCK: { tone: 'critical', text: () => 'Currently out of stock — remove it to continue' },
  UNAVAILABLE: { tone: 'critical', text: () => 'No longer sold by this seller — remove it to continue' },
};

/** Shopping Cart (order service GET /cart): guest cart via httpOnly cookie, signed-in cart via the session token. */
export default async function CartPage({ searchParams }: { searchParams: Promise<{ added?: string; err?: string; merge?: string; flag?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  // the login-time merge failed (order service was down) → retry once
  if (session?.realm === 'customers' && (await cartSessionId()) && !sp.merge) redirect(shopUrl('/api/cart/merge'));
  const [cart, picks] = await Promise.all([loadCart(CartSchema), loadPublic(ProductSearchSchema, '/api/catalog/v1/products?page=1')]);
  const flagged = new Set((sp.flag ?? '').split(',').filter(Boolean));
  const empty = !cart.ok ? cart.status === 204 || cart.status === 404 : cart.data.lines.length === 0;
  const shelf = picks.ok && (
    <Shelf title="Inspired by your shopping trends" href="/shop">
      {picks.data.items.slice(0, 12).map((x) => (
        <ProductCard key={x.productId} compact href={`/shop/p/${x.productId}`} image={x.imageId === null ? null : productImageUrl(x.productId, 'card')} category={x.category} title={x.title} priceMinor={x.minPriceMinor} mrpMinor={x.mrpMinor} currency={picks.data.currency} />
      ))}
    </Shelf>
  );

  if (!cart.ok && !empty)
    return (
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        <Notice tone="error" title="Your cart is unavailable right now">
          {cart.error} Your items are safe — try again in a moment.
        </Notice>
        {shelf}
      </main>
    );

  if (empty || !cart.ok)
    return (
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        <section className="rounded-[var(--radius)] bg-[var(--card)] p-6">
          <h1 className="text-[28px]">Your agentic.commerce Cart is empty</h1>
          <EmptyState icon={Glyph.cart} title="No items yet" text="Browse the shop and add items — your cart is kept for 7 days, and moves to your account when you sign in." action={<Button href="/shop" variant="primary">Continue shopping</Button>} />
          {!session && (
            <p className="mt-3 text-[14px]">
              <TextLink href="/api/auth/login?realm=customers&returnTo=/shop/cart">Sign in to your account</TextLink> to see items you added before.
            </p>
          )}
        </section>
        {shelf}
      </main>
    );

  const c = cart.data;
  // per-seller free-shipping hint
  const bySeller = new Map<string, { name: string; subtotal: number }>();
  for (const l of c.lines) {
    const s = bySeller.get(l.sellerId) ?? { name: l.sellerName, subtotal: 0 };
    s.subtotal += l.lineTotalMinor;
    bySeller.set(l.sellerId, s);
  }
  const short = [...bySeller.values()].filter((s) => s.subtotal < c.freeShippingOverMinor);
  const added = sp.added ? c.lines.find((l) => l.offerId === sp.added) : undefined;

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      {added && (
        <Notice tone="success" title="Added to cart">
          {added.title} · Qty {added.qty}
        </Notice>
      )}
      {sp.err && <Notice tone="error">{sp.err}</Notice>}
      {sp.merge === 'failed' && <Notice tone="warning">Items you added before signing in could not be moved yet. They are kept — refresh in a moment.</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <section className="rounded-[var(--radius)] bg-[var(--card)] p-5" aria-labelledby="cart-h">
          <div className="flex items-end justify-between border-b border-[var(--line)] pb-2">
            <h1 id="cart-h" className="text-[28px]">
              Shopping Cart
            </h1>
            <span className="hidden text-[14px] text-[var(--muted)] sm:block">Price</span>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {c.lines.map((l) => {
              const st = STATUS[l.status];
              const flag = flagged.has(l.offerId);
              return (
                <li key={l.offerId} className={`flex gap-4 py-4 ${flag ? 'rounded-md outline outline-2 outline-[var(--danger)]' : ''}`}>
                  <a href={`/shop/p/${l.productId}`} tabIndex={-1} aria-hidden>
                    <ProductImage src={productImageUrl(l.productId, 'card')} category={l.category} title={l.title} box={140} className="max-sm:!h-[96px] max-sm:!w-[96px]" />
                  </a>
                  <div className="min-w-0 flex-1 space-y-1 text-[14px]">
                    <div className="flex items-start justify-between gap-3">
                      <a href={`/shop/p/${l.productId}`} className="line-clamp-2 text-[16px] font-medium hover:text-[var(--link-hover)] hover:underline">
                        {l.title}
                      </a>
                      <b className="shrink-0 text-[18px] tabular-nums">{fmtMoney(l.unitPriceMinor, c.currency)}</b>
                    </div>
                    {l.mrpMinor && l.mrpMinor > l.unitPriceMinor && (
                      <p className="text-[12px] text-[var(--muted)]">
                        M.R.P.: <span className="line-through">{fmtMoney(l.mrpMinor, c.currency)}</span> <span className="text-[var(--danger)]">−{Math.round((1 - l.unitPriceMinor / l.mrpMinor) * 100)}%</span>
                      </p>
                    )}
                    {l.status === 'OK' && <p className="text-[12px] text-[var(--status-good)]">In stock</p>}
                    {st && (
                      <p>
                        <StatusBadge tone={st.tone}>{st.text(l, c.currency)}</StatusBadge>
                      </p>
                    )}
                    <p className="text-[12px] text-[var(--muted)]">Sold by {l.sellerName}</p>
                    <form action={setQty} className="flex flex-wrap items-center gap-3 pt-1">
                      <input type="hidden" name="offerId" value={l.offerId} />
                      <QtySelect value={l.qty} max={l.available} />
                      <span aria-hidden className="h-4 border-l border-[var(--line)]" />
                      <button type="submit" name="intent" value="delete" className="text-[12px] text-[var(--link)] hover:underline">
                        Delete
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-[var(--line)] pt-3 text-right text-[18px]">
            Subtotal ({c.itemCount} item{c.itemCount === 1 ? '' : 's'}): <b className="tabular-nums">{fmtMoney(c.subtotalMinor, c.currency)}</b>
          </p>
        </section>
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <section className="space-y-3 rounded-[var(--radius)] bg-[var(--card)] p-4 text-[14px]">
            {short.length === 0 ? (
              <p className="text-[13px] text-[var(--status-good)]">✓ Your order qualifies for FREE delivery.</p>
            ) : (
              <p className="text-[13px]">
                Add {short.map((s) => `${fmtMoney(c.freeShippingOverMinor - s.subtotal, c.currency)} from ${s.name}`).join(', ')} for FREE delivery.
              </p>
            )}
            <p className="text-[18px]">
              Subtotal ({c.itemCount} item{c.itemCount === 1 ? '' : 's'}): <b className="tabular-nums">{fmtMoney(c.subtotalMinor, c.currency)}</b>
            </p>
            {c.shippingMinor > 0 && <p className="text-[12px] text-[var(--muted)]">+ {fmtMoney(c.shippingMinor, c.currency)} delivery · total {fmtMoney(c.totalMinor, c.currency)}</p>}
            <p className="text-[12px] text-[var(--muted)]">Prices include GST.</p>
            {c.canCheckout ? (
              <Button href="/shop/checkout" variant="primary" className="w-full">
                Proceed to Buy
              </Button>
            ) : (
              <p className="text-[13px] text-[var(--danger)]">Fix the items marked above to continue.</p>
            )}
          </section>
        </aside>
      </div>
      {shelf}
    </main>
  );
}
