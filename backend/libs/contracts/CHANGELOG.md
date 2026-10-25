# @ac/contracts

## 0.7.0

### Minor changes

- P3 returns & agent governance (`returns.ts`): return requests, evidence, buyer return view, refund policy + policy result, agent case context / policy eval / proposal / evidence request, staff case detail + queue + approve/reject (dual control), shadow report, agent registry + autonomy, eval report, agent runs.
- Events: returns.case_proposed.v1, returns.case_decided.v1, returns.refund_executed.v1, agent.run_completed.v1; optional fields on returns.return_requested.v1.

## 0.6.1

### Patch changes

- Optional `orderId`, `paymentId`, `lifecycleStatus` on `BuyerOrderCardSchema` (Your Orders cards link to details and to the pay page).

## 0.6.0

### Minor changes

- P2 transactions (`commerce.ts`): cart (guest + signed-in), checkout + rejections, payment sessions (testpay, Stripe), order detail, cancel, seller orders + ship, reservations, stock levels/adjust, offer lookup, risk scoring, test payments.
- Events: order.confirmed/cancelled/shipped/delivered.v1, inventory.stock_reserved/reservation_released/stock_committed/low_stock.v1, payment.failed/refunded.v1, fraud.order_scored.v1, catalog.offer_updated.v1; optional offer/product/category fields on `order.created.v1` lines; `testpay` provider on `payment.succeeded.v1`.

## 0.5.0

### Minor changes

- Product images: `ImageSize`, `imageUrl()`, `productImageUrl()`, `categoryImageUrl()`, `ProductImageSchema` (+ attribution), `ImageOrderInputSchema`, `ImageRejectionSchema`; optional `ProductCard.imageId`, `ProductDetail.images`, `Category.hasImage`, `SellerSalesDashboard.topProducts[].productId`, `SellerStock.lowStock[].productId`.

## 0.4.1

### Patch changes

- Optional `version`, `productId`, `brand`, `category` on `ModerationDashboard.queue[]` items (needed to decide an item).

## 0.4.0

### Minor changes

- Marketplace model (`marketplace.ts`): seller accounts & KYC, category gating, Brand Registry with authorized resellers, shared catalog products + offers with listing rules, moderation decisions, versioned fee schedule with maker-checker, fee preview, seller fees. New event types listed in `MarketplaceEventTypes`.
- Additive optional `FinancePaymentsDashboard.fees`.

## 0.3.0

### Minor changes

- Amazon-style pages: `BuyerOrdersPageSchema` (Your Orders: tabs, ranges, order cards with lines), `BuyAgainSchema`.
- Additive optional fields: `SellerSalesDashboard.today`, `SellerOrdersDashboard.shipping` (account-health inputs).

## 0.2.0

### Minor changes

- Role dashboard read models (`dashboards.ts`): buyer, seller, platform, support, finance, fraud, catalog,
  moderation, admin overview, platform health and agent oversight DTOs. Additive — no existing schema changed.

## 0.1.0

- Initial contracts: money, paging, CloudEvents envelope, `Events` catalog, `TOPICS`.
