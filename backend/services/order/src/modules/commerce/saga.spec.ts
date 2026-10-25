import { describe, expect, it, vi } from 'vitest';
import { OutOfStock, runCheckoutSaga, SagaRejected, type SagaPorts, Unavailable } from './saga.js';

function ports(over: Partial<SagaPorts> = {}) {
  const p: SagaPorts = {
    score: vi.fn(async () => ({ decision: 'ALLOW' as const, score: 0, rules: [] })),
    saveRisk: vi.fn(async () => {}),
    reserve: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    createPayment: vi.fn(async () => ({ paymentId: 'p' })),
    reject: vi.fn(async () => {}),
    pending: vi.fn(async () => {}),
    ...over,
  };
  return p;
}

describe('checkout saga', () => {
  it('happy path ends PENDING_PAYMENT without compensation', async () => {
    const p = ports();
    await runCheckoutSaga(p);
    expect(p.pending).toHaveBeenCalledWith({ paymentId: 'p' });
    expect(p.release).not.toHaveBeenCalled();
    expect(p.reject).not.toHaveBeenCalled();
  });
  it('scorer failure defaults to REVIEW and continues', async () => {
    const p = ports({ score: vi.fn(async () => { throw new Error('timeout'); }) });
    const r = await runCheckoutSaga(p);
    expect(r.risk.decision).toBe('REVIEW');
    expect(p.pending).toHaveBeenCalled();
  });
  it('BLOCK rejects before touching stock', async () => {
    const p = ports({ score: vi.fn(async () => ({ decision: 'BLOCK' as const, score: 0.9, rules: ['blocked_pincode'] })) });
    await expect(runCheckoutSaga(p)).rejects.toMatchObject({ code: 'RISK_BLOCKED' });
    expect(p.reserve).not.toHaveBeenCalled();
  });
  it('out of stock rejects with the sold-out offers and needs no release', async () => {
    const p = ports({ reserve: vi.fn(async () => { throw new OutOfStock(['o1']); }) });
    const e = await runCheckoutSaga(p).catch((x) => x);
    expect(e).toBeInstanceOf(SagaRejected);
    expect(e.offerIds).toEqual(['o1']);
    expect(p.release).not.toHaveBeenCalled();
  });
  it('payment failure releases the reservation (compensation) and rejects', async () => {
    const p = ports({ createPayment: vi.fn(async () => { throw new Unavailable('down'); }) });
    await expect(runCheckoutSaga(p)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(p.release).toHaveBeenCalledTimes(1);
    expect(p.reject).toHaveBeenCalledWith('DEPENDENCY_UNAVAILABLE', expect.stringContaining('payment'));
    expect(p.pending).not.toHaveBeenCalled();
  });
  it('lost reservation answer still releases', async () => {
    const p = ports({ reserve: vi.fn(async () => { throw new Unavailable('timeout'); }) });
    await expect(runCheckoutSaga(p)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(p.release).toHaveBeenCalledTimes(1);
  });
});
