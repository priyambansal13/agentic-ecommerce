/**
 * Checkout saga orchestration (LLD §2.5) with explicit compensations — free of I/O so it can be unit tested.
 * Steps: create order → score risk (timeout ⇒ REVIEW) → reserve stock → create payment → PENDING_PAYMENT.
 */
export type Decision = 'ALLOW' | 'REVIEW' | 'BLOCK';
export interface SagaOrder { orderId: string; orderNo: string; totalMinor: number }
export interface SagaPorts {
  score(): Promise<{ decision: Decision; score: number; rules: string[] }>;
  saveRisk(r: { decision: Decision; score: number; rules: string[] }): Promise<void>;
  reserve(): Promise<void>; // throws OutOfStock | Unavailable
  release(): Promise<void>;
  createPayment(): Promise<unknown>; // throws Unavailable
  reject(reason: 'RISK_BLOCKED' | 'OUT_OF_STOCK' | 'DEPENDENCY_UNAVAILABLE', note: string): Promise<void>;
  pending(payment: unknown): Promise<void>;
}
export class OutOfStock extends Error {
  constructor(readonly skuIds: string[]) {
    super('insufficient stock');
  }
}
export class Unavailable extends Error {}
export class SagaRejected extends Error {
  constructor(readonly code: 'RISK_BLOCKED' | 'OUT_OF_STOCK' | 'DEPENDENCY_UNAVAILABLE', message: string, readonly offerIds: string[] = []) {
    super(message);
  }
}

export async function runCheckoutSaga(p: SagaPorts) {
  let risk: { decision: Decision; score: number; rules: string[] };
  try {
    risk = await p.score();
  } catch {
    risk = { decision: 'REVIEW', score: 0.5, rules: ['fraud_unavailable'] }; // never block checkout on the scorer
  }
  await p.saveRisk(risk);
  if (risk.decision === 'BLOCK') {
    await p.reject('RISK_BLOCKED', `blocked by fraud rules: ${risk.rules.join(', ')}`);
    throw new SagaRejected('RISK_BLOCKED', 'We could not place this order. Contact customer service if you think this is a mistake.');
  }
  try {
    await p.reserve();
  } catch (e) {
    if (e instanceof OutOfStock) {
      await p.reject('OUT_OF_STOCK', `insufficient stock: ${e.skuIds.join(', ')}`);
      throw new SagaRejected('OUT_OF_STOCK', 'Some items just sold out — your cart was updated.', e.skuIds);
    }
    // the reservation may have been made even though we did not get the answer → release is idempotent
    await p.release().catch(() => {});
    await p.reject('DEPENDENCY_UNAVAILABLE', `inventory unavailable: ${(e as Error).message}`);
    throw new SagaRejected('DEPENDENCY_UNAVAILABLE', 'Checkout is temporarily unavailable — nothing was charged. Please try again.');
  }
  let payment: unknown;
  try {
    payment = await p.createPayment();
  } catch (e) {
    await p.release().catch(() => {});
    await p.reject('DEPENDENCY_UNAVAILABLE', `payment unavailable: ${(e as Error).message}`);
    throw new SagaRejected('DEPENDENCY_UNAVAILABLE', 'Payments are temporarily unavailable — nothing was charged. Please try again.');
  }
  await p.pending(payment);
  return { risk, payment };
}
