/**
 * Demo data: payments, refunds, payouts and BALANCED ledger transactions → this service's own database only.
 * Capture:  debit gateway:clearing = credit seller:<id>:payable (each seller's lines) + platform:shipping (any rest)
 * Fees:     per order and seller, debit seller:<id>:payable = credit platform:fees (referral + closing + payment) + tax:gst_payable
 *           — computed with fee schedule v1 (fee-math.ts); detail rows in order_fees.
 * Refund:   debit seller:<id>:payable = credit gateway:clearing (fees are not refunded in the demo).
 * Integer amounts — every transaction sums exactly. `pnpm seed`
 */
import { CURRENCY, demoWorld, replaceRows } from '@ac/demo-data';
import { loadServiceEnv, serviceDataSource } from '@ac/nest-common';
import { createHash } from 'node:crypto';
import { ENTITIES } from './modules/dashboard/entities/payment.entity.js';
import { LAUNCH_SCHEDULE, lineFees } from './modules/fees/fee-math.js';

loadServiceEnv();
const ds = serviceDataSource(ENTITIES);
await ds.initialize();
await ds.runMigrations();
const q = (sql: string, p?: unknown[]) => ds.query(sql, p as unknown[]);
const w = demoWorld();
const stableUuid = (key: string) => {
  const h = createHash('md5').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const orderById = new Map(w.orders.map((o) => [o.id, o]));
const sellerName = new Map(w.sellers.map((s) => [s.id, s.name]));

// live P2 state is reset with the demo world (attempts/refunds cascade from payments)
for (const t of ['webhook_events', 'payment_order_lines']) await q(`TRUNCATE TABLE ${t}`);
// demo captures are fully allocated (their ledger postings below already credit the sellers)
const payments = await replaceRows(q, 'payments', ['id', 'order_id', 'amount_minor', 'currency', 'status', 'captured_at', 'allocated_at'],
  w.payments.map((p) => [p.id, p.orderId, p.amountMinor, CURRENCY, p.status, p.capturedAt, p.status === 'SUCCEEDED' ? p.capturedAt : null]));
// order lines read model (what order.created.v1 would have delivered) → refunds of demo orders allocate correctly
const categoryById = new Map(w.products.map((p) => [p.id, p.category]));
const lineRows = new Map<string, unknown[]>();
for (const o of w.orders) for (const l of o.lines) {
  const key = `${o.id}:${l.productId}:${l.sellerId}:${l.unitPriceMinor}`;
  const prev = lineRows.get(key);
  if (prev) prev[6] = (prev[6] as number) + l.qty;
  else lineRows.set(key, [o.id, stableUuid(`sku:${l.productId}:${l.sellerId}:${l.unitPriceMinor}`), l.sellerId, l.productId, categoryById.get(l.productId) ?? '*', null, l.qty, l.unitPriceMinor]);
}
await replaceRows(q, 'payment_order_lines', ['order_id', 'sku_id', 'seller_id', 'product_id', 'category', 'title', 'qty', 'unit_price_minor'], [...lineRows.values()]);

const ledger: unknown[][] = [];
const feeRows: unknown[][] = [];
const categoryOf = new Map(w.products.map((p) => [p.id, p.category]));
for (const p of w.payments) {
  if (p.status !== 'SUCCEEDED') continue;
  const o = orderById.get(p.orderId)!;
  const tx = stableUuid(`capture:${p.id}`);
  const perSeller = new Map<string, number>();
  for (const l of o.lines) perSeller.set(l.sellerId, (perSeller.get(l.sellerId) ?? 0) + l.qty * l.unitPriceMinor);
  let payable = 0;
  ledger.push([tx, 'CAPTURE', 'gateway:clearing', p.amountMinor, 0, p.capturedAt]);
  for (const [sellerId, gross] of perSeller) {
    payable += gross;
    ledger.push([tx, 'CAPTURE', `seller:${sellerId}:payable`, 0, gross, p.capturedAt]);
  }
  if (p.amountMinor !== payable) ledger.push([tx, 'CAPTURE', 'platform:shipping', 0, p.amountMinor - payable, p.capturedAt]);
  // marketplace fees per seller (one FEE transaction each)
  const feesBySeller = new Map<string, { fees: number; gst: number }>();
  for (const l of o.lines) {
    const category = categoryOf.get(l.productId) ?? '*';
    const f = lineFees(LAUNCH_SCHEDULE, category, l.unitPriceMinor, l.qty);
    feeRows.push([o.id, l.sellerId, l.productId, category, f.saleMinor, f.referralMinor, f.closingMinor, f.paymentMinor, f.gstMinor, CURRENCY, LAUNCH_SCHEDULE.version, p.capturedAt]);
    const acc = feesBySeller.get(l.sellerId) ?? { fees: 0, gst: 0 };
    acc.fees += f.referralMinor + f.closingMinor + f.paymentMinor;
    acc.gst += f.gstMinor;
    feesBySeller.set(l.sellerId, acc);
  }
  for (const [sellerId, f] of feesBySeller) {
    const ftx = stableUuid(`fees:${p.id}:${sellerId}`);
    ledger.push([ftx, 'FEE', `seller:${sellerId}:payable`, f.fees + f.gst, 0, p.capturedAt]);
    ledger.push([ftx, 'FEE', 'platform:fees', 0, f.fees, p.capturedAt]);
    ledger.push([ftx, 'FEE', 'tax:gst_payable', 0, f.gst, p.capturedAt]);
  }
}
const refundRows: unknown[][] = [];
for (const c of w.refundCases) {
  if (!['REFUNDED', 'REFUND_PENDING', 'AUTO_APPROVED'].includes(c.status) || !c.approvedMinor) continue;
  const done = c.status === 'REFUNDED';
  const at = c.resolvedAt ?? c.openedAt;
  refundRows.push([stableUuid(`refund:${c.id}`), c.id, c.approvedMinor, CURRENCY, done ? 'SUCCEEDED' : 'PENDING', at]);
  if (!done) continue;
  const tx = stableUuid(`refund-tx:${c.id}`);
  ledger.push([tx, 'REFUND', `seller:${c.sellerId}:payable`, c.approvedMinor, 0, at]);
  ledger.push([tx, 'REFUND', 'gateway:clearing', 0, c.approvedMinor, at]);
}
const refunds = await replaceRows(q, 'refunds', ['id', 'refund_case_id', 'amount_minor', 'currency', 'status', 'created_at'], refundRows);
const payouts = await replaceRows(q, 'payouts', ['id', 'seller_id', 'seller_name', 'amount_minor', 'currency', 'status', 'scheduled_on', 'paid_at'],
  w.payouts.map((x) => [x.id, x.sellerId, sellerName.get(x.sellerId) ?? 'unknown', x.amountMinor, CURRENCY, x.status, x.scheduledOn.toISOString().slice(0, 10), x.paidAt]));
const entries = await replaceRows(q, 'ledger_entries', ['tx_id', 'kind', 'account', 'debit_minor', 'credit_minor', 'created_at'], ledger);
const fees = await replaceRows(q, 'order_fees', ['order_id', 'seller_id', 'product_id', 'category', 'sale_minor', 'referral_minor', 'closing_minor', 'payment_minor', 'gst_minor', 'currency', 'schedule_version', 'created_at'], feeRows);
const launch = new Date(w.now.getTime() - 400 * 86_400_000);
const schedules = await replaceRows(q, 'fee_schedules', ['id', 'version', 'status', 'effective_from', 'payment_fee_bps', 'gst_bps', 'rules', 'note', 'created_by', 'created_by_name', 'submitted_by', 'submitted_by_name', 'approved_by', 'approved_by_name', 'created_at', 'approved_at'],
  [[stableUuid('fee-schedule:v1'), 1, 'ACTIVE', launch, LAUNCH_SCHEDULE.paymentFeeBps, LAUNCH_SCHEDULE.gstBps, JSON.stringify(LAUNCH_SCHEDULE.rules), 'Launch fee schedule', 'seed', 'finance (demo)', 'seed', 'finance (demo)', 'seed-admin', 'admin (demo)', launch, launch]]);
console.log(`payment seed: ${fees} order_fees, ${schedules} fee_schedules`);
console.log(`payment seed: ${payments} payments, ${refunds} refunds, ${payouts} payouts, ${entries} ledger entries`);
await ds.destroy();
