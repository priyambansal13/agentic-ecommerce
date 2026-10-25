import { productImageUrl, type RefundCaseView } from '@ac/contracts';
import type { OrderCardData as BuyerOrderCard } from '../lib/orders';
import { Button, fmtMoney, ProductImage, StatusBadge, TextLink } from '@ac/ui';

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

function headline(o: BuyerOrderCard) {
  if (o.status === 'CANCELLED') return { text: 'Cancelled', tone: 'text-[var(--danger)]' };
  if (o.status === 'PENDING_PAYMENT' || o.status === 'CREATED') return { text: 'Payment pending — complete payment to confirm', tone: 'text-[var(--danger)]' };
  if (o.status === 'PAYMENT_FAILED') return { text: 'Payment failed — the order was not placed', tone: 'text-[var(--danger)]' };
  if (o.status === 'REJECTED') return { text: 'Order could not be placed — you were not charged', tone: 'text-[var(--danger)]' };
  if (o.status === 'PARTIALLY_SHIPPED') return { text: 'Partly shipped', tone: 'text-[var(--success)]' };
  if (o.deliveredAt) return { text: `Delivered ${longDate(o.deliveredAt)}`, tone: '' };
  if (o.eta) return { text: `Arriving ${shortDate(o.eta)}`, tone: 'text-[var(--success)]' };
  return { text: o.status.toLowerCase().replaceAll('_', ' '), tone: '' };
}

export const RETURN_TEXT: Record<string, string> = {
  REFUNDED: 'Refund issued',
  REFUND_PENDING: 'Refund on its way',
  AUTO_APPROVED: 'Return approved',
  APPROVED: 'Return approved',
  PENDING_HUMAN: 'Return under review by our team',
  AWAITING_BUYER: 'We need a photo to continue your return',
  GATHERING_EVIDENCE: 'Return started',
  REJECTED: 'Return not approved',
};

/** Amazon-style order card: grey header (placed / total / ship to / order #), status line, items, actions. */
export function OrderCard({ order: o, currency, refund }: { order: BuyerOrderCard; currency: string; refund?: RefundCaseView }) {
  const h = headline(o);
  const help = `/account/help?order=${encodeURIComponent(o.orderNo)}`;
  // order details page (the order service accepts the id or the order number)
  const details = `/account/orders/${o.orderId ?? encodeURIComponent(o.orderNo)}`;
  return (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)]" aria-label={`Order ${o.orderNo}`}>
      <header className="flex flex-wrap gap-x-10 gap-y-2 border-b border-[var(--line)] bg-[var(--surface-2)] px-5 py-3 text-[12px] text-[var(--muted)]">
        <div>
          <p className="uppercase">Order placed</p>
          <p className="text-[14px] text-[var(--fg)]">{longDate(o.placedAt)}</p>
        </div>
        <div>
          <p className="uppercase">Total</p>
          <p className="text-[14px] text-[var(--fg)]">{fmtMoney(o.totalMinor, currency)}</p>
        </div>
        <div>
          <p className="uppercase">Ship to</p>
          <p className="text-[14px] text-[var(--link)]" title={o.shipToCity}>
            {o.shipToName} ▾
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="uppercase">Order # {o.orderNo}</p>
          <TextLink href={details} className="mr-3 text-[14px]">
            View order details
          </TextLink>
          <TextLink href={help} className="text-[14px]">
            Get help with this order
          </TextLink>
        </div>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4 md:flex-row">
        <div className="flex-1 space-y-3">
          <h3 className={`text-[18px] font-bold ${h.tone}`}>{h.text}</h3>
          {refund && (
            <p className="flex flex-wrap items-center gap-2 text-[14px]">
              <StatusBadge tone={refund.status === 'REJECTED' ? 'critical' : ['REFUNDED', 'REFUND_PENDING', 'AUTO_APPROVED', 'APPROVED'].includes(refund.status) ? 'good' : 'warning'}>
                {RETURN_TEXT[refund.status] ?? refund.status.toLowerCase()}
              </StatusBadge>
              <span className="text-[var(--muted)]">{fmtMoney(refund.proposedMinor ?? refund.requestedMinor, currency)}</span>
              <TextLink href={`/account/returns/${refund.caseId}`} className="text-[13px]">
                View return
              </TextLink>
            </p>
          )}
          {o.lines.map((l, i) => (
            <div key={`${l.productId}-${i}`} className="flex gap-4">
              <a href={`/shop/p/${l.productId}`} aria-hidden tabIndex={-1} className="rounded-md border border-[var(--line)] bg-white p-1">
                <ProductImage src={productImageUrl(l.productId, 'thumb')} category={l.category} title={l.title} box={90} />
              </a>
              <div className="space-y-1 text-[14px]">
                <TextLink href={`/shop/p/${l.productId}`} className="font-bold">
                  {l.title}
                </TextLink>
                <p className="text-[12px] text-[var(--muted)]">Sold by: {l.sellerName}</p>
                <p className="text-[12px] text-[var(--muted)]">
                  Qty {l.qty} · {fmtMoney(l.unitPriceMinor, currency)}
                </p>
                {o.status === 'DELIVERED' && (
                  <Button href={`/shop/p/${l.productId}`} variant="primary" className="mt-1">
                    ↻ Buy it again
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 flex-col gap-2 md:w-56">
          {(o.status === 'PENDING_PAYMENT' || o.status === 'CREATED') && o.paymentId && (
            <Button href={`/shop/pay/${o.paymentId}`} variant="primary">
              Complete payment
            </Button>
          )}
          {['SHIPPED', 'PARTIALLY_SHIPPED', 'CONFIRMED', 'PAID'].includes(o.status) && (
            <Button href={details} variant="primary">
              Track package
            </Button>
          )}
          {o.status === 'DELIVERED' && !refund && (
            <Button href={`/account/returns/new?orderId=${encodeURIComponent(o.orderId ?? o.orderNo)}`}>Return or replace items</Button>
          )}
          {o.status === 'DELIVERED' && <Button href={help}>Write a product review</Button>}
          {['PENDING_PAYMENT', 'PAID', 'CONFIRMED'].includes(o.status) && <Button href={`${details}#cancel`}>Cancel items</Button>}
          <Button href={details}>View order details</Button>
          <Button href={help}>Get help</Button>
        </div>
      </div>
    </article>
  );
}
