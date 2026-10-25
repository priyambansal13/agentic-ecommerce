/**
 * Email / in-app templates (pure). Product titles and notes come from sellers and buyers → always escaped
 * (untrusted text is data). Amounts are integer paise, rendered in en-IN rupees.
 */
export type Kind = 'ORDER_CONFIRMED' | 'ORDER_SHIPPED' | 'ORDER_DELIVERED' | 'ORDER_CANCELLED' | 'PAYMENT_FAILED' | 'PAYMENT_REFUNDED';
export interface Line { title?: string; qty: number; unitPriceMinor: number }
export interface TemplateData {
  orderNo: string;
  appUrl: string;
  lines?: Line[];
  totalMinor?: number;
  carrier?: string;
  trackingNo?: string;
  reason?: string;
  note?: string;
  refundRequired?: boolean;
  amountMinor?: number;
}
export interface Rendered { subject: string; text: string; html: string }

export const rupees = (minor: number) => `₹${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const REASONS: Record<string, string> = {
  BUYER_CANCELLED: 'You cancelled this order.',
  PAYMENT_EXPIRED: 'We did not receive the payment in time, so the items were released.',
  PAYMENT_FAILED: 'The payment did not go through.',
  RISK_REJECTED: 'We could not verify this order.',
  OUT_OF_STOCK: 'An item went out of stock.',
};
const TRACK: Record<string, (n: string) => string> = {
  Delhivery: (n) => `https://www.delhivery.com/track/package/${n}`,
  'Blue Dart': (n) => `https://www.bluedart.com/tracking?awb=${n}`,
  DTDC: (n) => `https://www.dtdc.in/tracking.asp?cnno=${n}`,
  'India Post': (n) => `https://www.indiapost.gov.in/?consignment=${n}`,
  Ekart: (n) => `https://ekartlogistics.com/shipmenttrack/${n}`,
};

function layout(title: string, bodyHtml: string, cta: { href: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#eaeded;font-family:Arial,Helvetica,sans-serif;color:#0f1111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eaeded;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:#131921;padding:16px 24px;color:#fff;font-size:20px;font-weight:bold">agentic<span style="color:#ff9900">.commerce</span></td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>${bodyHtml}
<p style="margin:24px 0 0"><a href="${esc(cta.href)}" style="background:#ffd814;color:#0f1111;text-decoration:none;padding:10px 18px;border-radius:20px;display:inline-block">${esc(cta.label)}</a></p></td></tr>
<tr><td style="padding:16px 24px;background:#f7f7f7;color:#565959;font-size:12px">This is a demo store — no real goods or money are involved.</td></tr>
</table></td></tr></table></body></html>`;
}

function linesTable(lines: Line[] = []) {
  const rows = lines
    .map((l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(l.title ?? 'Item')} × ${l.qty}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #eee">${rupees(l.qty * l.unitPriceMinor)}</td></tr>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}</table>`;
}
const linesText = (lines: Line[] = []) => lines.map((l) => `  - ${l.title ?? 'Item'} × ${l.qty}  ${rupees(l.qty * l.unitPriceMinor)}`).join('\n');

export function render(kind: Kind, d: TemplateData): Rendered {
  const orders = `${d.appUrl}/account/orders`;
  switch (kind) {
    case 'ORDER_CONFIRMED': {
      const subject = `Your agentic.commerce order ${d.orderNo} is confirmed`;
      const total = d.totalMinor !== undefined ? rupees(d.totalMinor) : '';
      return {
        subject,
        text: `Thanks for your order!\n\nOrder ${d.orderNo}\n${linesText(d.lines)}\n\nOrder total: ${total}\n\nTrack it: ${orders}`,
        html: layout('Thanks for your order!', `<p>Order <b>${esc(d.orderNo)}</b> is confirmed. We'll email you when it ships.</p>${linesTable(d.lines)}<p style="font-size:16px"><b>Order total: ${total}</b></p>`, { href: orders, label: 'View your order' }),
      };
    }
    case 'ORDER_SHIPPED': {
      const track = d.carrier && d.trackingNo ? (TRACK[d.carrier]?.(encodeURIComponent(d.trackingNo)) ?? orders) : orders;
      return {
        subject: `Shipped: your order ${d.orderNo}`,
        text: `Your package is on its way.\n\nOrder ${d.orderNo}\nCarrier: ${d.carrier} · Tracking no. ${d.trackingNo}\nTrack: ${track}`,
        html: layout('Your package is on its way', `<p>Order <b>${esc(d.orderNo)}</b> has shipped with <b>${esc(d.carrier ?? '')}</b>.</p><p>Tracking number: <b>${esc(d.trackingNo ?? '')}</b></p>`, { href: track, label: 'Track package' }),
      };
    }
    case 'ORDER_DELIVERED':
      return {
        subject: `Delivered: your order ${d.orderNo}`,
        text: `Your package was delivered.\n\nOrder ${d.orderNo}\nSomething wrong? Return or replace items: ${orders}`,
        html: layout('Your package was delivered', `<p>Order <b>${esc(d.orderNo)}</b> was delivered. Something not right? You can return or replace items from Your Orders.</p>`, { href: orders, label: 'Your Orders' }),
      };
    case 'ORDER_CANCELLED': {
      const why = REASONS[d.reason ?? ''] ?? 'Your order was cancelled.';
      const refund = d.refundRequired && d.amountMinor ? `A refund of ${rupees(d.amountMinor)} is on its way to your original payment method.` : 'You have not been charged.';
      return {
        subject: `Cancelled: your order ${d.orderNo}`,
        text: `Order ${d.orderNo} was cancelled.\n${why}\n${refund}${d.note ? `\nNote: ${d.note}` : ''}`,
        html: layout('Your order was cancelled', `<p>Order <b>${esc(d.orderNo)}</b> was cancelled. ${esc(why)}</p><p>${esc(refund)}</p>${d.note ? `<p style="color:#565959">Note: ${esc(d.note)}</p>` : ''}`, { href: orders, label: 'Your Orders' }),
      };
    }
    case 'PAYMENT_FAILED':
      return {
        subject: `Payment failed for order ${d.orderNo}`,
        text: `The payment for order ${d.orderNo} did not go through${d.reason ? `: ${d.reason}` : ''}. You can place the order again from your cart.`,
        html: layout('Your payment did not go through', `<p>The payment for order <b>${esc(d.orderNo)}</b> failed${d.reason ? `: ${esc(d.reason)}` : ''}. Nothing was charged.</p>`, { href: `${d.appUrl}/shop/cart`, label: 'Go to cart' }),
      };
    case 'PAYMENT_REFUNDED': {
      const amt = d.amountMinor !== undefined ? rupees(d.amountMinor) : 'Your refund';
      return {
        subject: `Refund of ${amt} issued for order ${d.orderNo}`,
        text: `We've issued a refund of ${amt} for order ${d.orderNo}. It usually reaches your account in 5–7 business days.`,
        html: layout('Your refund is on its way', `<p>We've issued a refund of <b>${amt}</b> for order <b>${esc(d.orderNo)}</b>. It usually reaches your account in 5–7 business days.</p>`, { href: orders, label: 'Your Orders' }),
      };
    }
  }
}
