import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  BuyerOrdersPageSchema,
  type CaseContext,
  CaseContextSchema,
  CaseDetailSchema,
  CaseQueueSchema,
  type CaseStatus,
  MyReturnsSchema,
  OrderDetailSchema,
  type PolicyResult,
  PolicyResultSchema,
  ProductDetailSchema,
  type ProposalInput,
  type ReasonCode,
  RefundPolicySchema,
  type Resolution,
  type ReturnInput,
  ReturnViewSchema,
  ShadowReportSchema,
  TOPICS,
} from '@ac/contracts';
import { DependencyError, OutboxService, type PrincipalInfo, ServiceClient } from '@ac/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { EvidenceError, hamming, MAX_PHOTOS_PER_CASE, processEvidence } from './evidence-image.js';
import { ObjectStore } from './object-store.js';
import { evaluatePolicy, localRisk, type PolicyInput, POLICY_V1, type PolicyRules, RULE_TEXT, textSignals } from './policy.js';
import { ApprovalError, approvalStep, assertRefundable, assertTransition, COUNTS_AS_RETURNED, executeDecision, MONEY_OUTCOMES, OPEN_STATUSES, STATUS_TEXT, TransitionError } from './state.js';

const CURRENCY = 'INR';
const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
/** raw UPDATE … RETURNING through TypeORM returns [rows, count] */
const rowsOf = (r: any): any[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r);
const inr = (minor: number) => `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const STAFF = ['support', 'finance', 'admin'];
const PAID_ORDER = ['PAID', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'RETURN_IN_PROGRESS', 'PARTIALLY_REFUNDED'];

interface Snapshot {
  orderStatus: string;
  placedAt: string;
  totalMinor: number;
  capturedMinor: number;
  sellerId: string;
  sellerName: string;
  sellerOrderStatus: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  carrier: string | null;
  trackingNo: string | null;
  city: string | null;
  pincode: string | null;
  orders180d: number;
}

export function carrierStatusOf(sellerOrderStatus: string): CaseContext['tracking']['carrierStatus'] {
  if (sellerOrderStatus === 'DELIVERED') return 'DELIVERED';
  if (sellerOrderStatus === 'SHIPPED') return 'IN_TRANSIT';
  if (['CONFIRMED', 'PENDING_PAYMENT', 'PAID'].includes(sellerOrderStatus)) return 'NOT_SHIPPED';
  return 'UNKNOWN';
}

/** Internal endpoints: realm role `service`, or an exchanged agent token (act.sub = agent:…) carrying `scope`. */
export function assertInternal(p: PrincipalInfo, scope: string) {
  if (p.roles.includes('service')) return;
  if (p.actor?.startsWith('agent:') && p.scopes.includes(scope)) return;
  throw new ForbiddenException(`internal endpoint: needs role "service" or an agent token with scope ${scope}`);
}

function httpOf(e: unknown): never {
  if (e instanceof ApprovalError) throw new HttpException({ message: e.message }, e.status);
  if (e instanceof TransitionError) throw new ConflictException({ message: e.message });
  throw e;
}

@Injectable()
export class ReturnsService {
  private readonly log = new Logger(ReturnsService.name);
  constructor(
    private readonly db: DataSource,
    private readonly outbox: OutboxService,
    private readonly svc: ServiceClient,
    private readonly store: ObjectStore,
  ) {}

  // ───────────────────────────────────────────── policy
  async rules(tx: EntityManager | DataSource = this.db): Promise<PolicyRules> {
    const [row] = await tx.query(`SELECT rules FROM refund_policies WHERE active LIMIT 1`);
    return (row?.rules as PolicyRules) ?? POLICY_V1;
  }

  async policy() {
    const [row] = await this.db.query(`SELECT * FROM refund_policies WHERE active LIMIT 1`);
    const r: PolicyRules = row?.rules ?? POLICY_V1;
    return RefundPolicySchema.parse({
      version: r.version,
      effectiveFrom: iso(row?.effective_from) ?? new Date(0).toISOString(),
      approvedBy: row?.approved_by ?? 'built-in default',
      rules: RULE_TEXT,
      returnWindowDays: r.returnWindowDays,
      autoMaxMinor: r.autoMaxMinor,
      maxRisk: r.maxRisk,
      dualControlMinor: r.dualControlMinor,
    });
  }

  // ───────────────────────────────────────────── buyer: create
  async createReturn(p: PrincipalInfo, input: ReturnInput) {
    // 1. order snapshot through the order service, with the buyer's own token (ownership enforced there too)
    let order;
    try {
      order = await this.svc.call('order', 'GET', `/orders/${input.orderId}`, { userToken: p.token, schema: OrderDetailSchema, timeoutMs: 3000 });
    } catch (e) {
      if (e instanceof DependencyError && (e.status === 404 || e.status === 403)) throw new ForbiddenException({ code: 'NOT_OWNER', message: 'This order was not found in your account.' });
      throw new HttpException({ message: 'The order service is unavailable — try again shortly.' }, 503);
    }
    const subs = order.sellerOrders.filter((s) => s.lines.some((l) => input.lines.some((x) => x.productId === l.productId)));
    if (subs.length !== 1) throw new UnprocessableEntityException({ code: 'ORDER_NOT_ELIGIBLE', message: subs.length ? 'Return items from one seller at a time.' : 'Those items are not in this order.' });
    const so = subs[0];
    const okStatus = input.reasonCode === 'NOT_DELIVERED' || input.reasonCode === 'LATE' ? ['CONFIRMED', 'SHIPPED', 'DELIVERED'] : ['DELIVERED'];
    if (!okStatus.includes(so.status))
      throw new UnprocessableEntityException({ code: 'ORDER_NOT_ELIGIBLE', message: so.status === 'CANCELLED' ? 'This order was cancelled.' : `Items can be returned once delivered (this shipment is ${so.status.toLowerCase().replace('_', ' ')}).` });
    const deliveredAt = so.deliveredAt ? new Date(so.deliveredAt) : null;
    const rules = await this.rules();
    if (deliveredAt && (Date.now() - deliveredAt.getTime()) / 86_400_000 > rules.hardStopDays)
      throw new UnprocessableEntityException({ code: 'OUTSIDE_WINDOW', message: `Returns can't be requested more than ${rules.hardStopDays} days after delivery.` });

    // 2. qty ≤ ordered − already returned; one open case per item
    const already = await this.db.query(
      `SELECT ri.product_id, sum(ri.qty) AS qty, bool_or(c.status = ANY($3)) AS open
         FROM return_items ri JOIN return_requests rr ON rr.id = ri.return_request_id JOIN refund_cases c ON c.return_request_id = rr.id
        WHERE rr.order_id = $1 AND c.status = ANY($2) GROUP BY ri.product_id`,
      [input.orderId, COUNTS_AS_RETURNED, OPEN_STATUSES],
    );
    const prior = new Map<string, { qty: number; open: boolean }>(already.map((r: any) => [r.product_id, { qty: n(r.qty), open: r.open }]));
    const lines: { productId: string; title: string; qty: number; unitPriceMinor: number; category: string }[] = [];
    for (const want of input.lines) {
      const line = so.lines.find((l) => l.productId === want.productId)!;
      const before = prior.get(want.productId);
      if (before?.open) throw new ConflictException({ code: 'ALREADY_OPEN', message: `There is already an open return for “${line.title}”.` });
      if (want.qty > line.qty - (before?.qty ?? 0)) throw new UnprocessableEntityException({ code: 'QTY_EXCEEDS_ORDERED', message: `You can return at most ${line.qty - (before?.qty ?? 0)} of “${line.title}”.` });
      lines.push({ productId: line.productId, title: line.title, qty: want.qty, unitPriceMinor: line.unitPriceMinor, category: await this.categoryOf(line.productId) });
    }
    const requestedMinor = lines.reduce((s, l) => s + l.qty * l.unitPriceMinor, 0);
    if (requestedMinor <= 0) throw new UnprocessableEntityException({ code: 'ORDER_NOT_ELIGIBLE', message: 'Nothing to refund on these items.' });

    // 3. buyer history input (orders in 6 months from the order service, refunds from our own data)
    const orders180d = await this.svc
      .call('order', 'GET', '/orders/mine?tab=all&range=6m&page=1', { userToken: p.token, schema: BuyerOrdersPageSchema, timeoutMs: 3000 })
      .then((r) => r.counts.all)
      .catch(() => 0);
    const snapshot: Snapshot = {
      orderStatus: order.status,
      placedAt: order.placedAt,
      totalMinor: order.totalMinor,
      capturedMinor: PAID_ORDER.includes(order.status) || order.payment?.status === 'SUCCEEDED' ? order.totalMinor : 0,
      sellerId: so.sellerId,
      sellerName: so.sellerName,
      sellerOrderStatus: so.status,
      shippedAt: so.shippedAt,
      deliveredAt: so.deliveredAt,
      carrier: so.carrier,
      trackingNo: so.trackingNo,
      city: order.shippingAddress?.city ?? null,
      pincode: order.shippingAddress?.pincode ?? null,
      orders180d,
    };
    const signals = textSignals(input.buyerText);

    // 4. one transaction: request + items + case + evidence + history + outbox; policy decides the first route
    const returnId = randomUUID();
    const caseId = randomUUID();
    const result = await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO return_requests (id, order_id, order_no, buyer_id, seller_id, reason_code, buyer_text, preferred, snapshot, signals) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [returnId, order.orderId, order.orderNo, p.sub, so.sellerId, input.reasonCode, input.buyerText, input.preferred, JSON.stringify(snapshot), JSON.stringify(signals)],
      );
      for (const l of lines)
        await tx.query(`INSERT INTO return_items (return_request_id, product_id, title, category, qty, unit_price_minor) VALUES ($1,$2,$3,$4,$5,$6)`, [returnId, l.productId, l.title, l.category, l.qty, l.unitPriceMinor]);
      await tx.query(
        `INSERT INTO refund_cases (id, order_id, order_no, buyer_id, seller_id, reason, status, requested_minor, currency, opened_at, return_request_id, preferred, buyer_text, version)
         VALUES ($1,$2,$3,$4,$5,$6,'REQUESTED',$7,$8,now(),$9,$10,$11,1)`,
        [caseId, order.orderId, order.orderNo, p.sub, so.sellerId, input.reasonCode, requestedMinor, CURRENCY, returnId, input.preferred, input.buyerText],
      );
      await this.addFact(tx, caseId, 'ORDER_SNAPSHOT', { orderStatus: order.status, sellerOrderStatus: so.status, deliveredAt: so.deliveredAt, totalMinor: order.totalMinor }, `user:${p.sub}`);
      await this.addFact(tx, caseId, 'TRACKING', { carrier: so.carrier, trackingNo: so.trackingNo, carrierStatus: carrierStatusOf(so.status), shippedAt: so.shippedAt, deliveredAt: so.deliveredAt }, 'system');
      await this.addFact(tx, caseId, 'BUYER_TEXT', { length: input.buyerText.length, signals }, `user:${p.sub}`);
      await this.history(tx, caseId, `user:${p.sub}`, 'REQUESTED', null, null, null, 'REQUESTED');
      await this.outbox.enqueue(tx, {
        topic: TOPICS.returns,
        type: 'returns.return_requested.v1',
        aggregateId: caseId,
        data: { returnId, caseId, orderId: order.orderId, buyerId: p.sub, reasonCode: input.reasonCode, requestedMinor, orderNo: order.orderNo },
      });
      const c = await this.lockCase(tx, caseId);
      const ctx = await this.buildContext(tx, c);
      const risk = localRisk({ requestedMinor, reasonCode: input.reasonCode, carrierStatus: ctx.tracking.carrierStatus, buyerHistory: ctx.buyerHistory }, signals);
      const pol = evaluatePolicy(this.policyInput(ctx), risk, signals, rules);
      if (pol.hardReject) {
        const why = pol.ruleHits.filter((h) => h.effect === 'REJECT').map((h) => h.detail).join('; ');
        await this.transition(tx, c, 'REJECTED', 'policy', {
          outcome: 'REJECT', note: why, rationale: { ruleHits: pol.ruleHits },
          set: { resolution: 'REJECT', decided_by: 'policy', resolved_at: new Date(), risk_score: risk, policy: pol, policy_version: pol.policyVersion, required_role: null, explanation: `We can't accept this return: ${why}. If you think this is wrong, you can appeal.` },
        });
        await this.decided(tx, caseId, 'REJECT', 0, 'policy', 'REJECTED');
      } else {
        await this.transition(tx, c, 'PENDING_HUMAN', 'policy', {
          outcome: 'ROUTE', note: pol.autoEligible ? 'inside the auto-approve envelope; waiting for a reviewer (agent in shadow mode)' : 'needs a reviewer',
          rationale: { ruleHits: pol.ruleHits },
          set: { risk_score: risk, policy: pol, policy_version: pol.policyVersion, required_role: 'support', dual_control: pol.dualControl },
        });
      }
      return { returnId };
    });
    return this.view(p, result.returnId);
  }

  private async categoryOf(productId: string) {
    try {
      const d = await this.svc.call('catalog', 'GET', `/products/${productId}`, { schema: ProductDetailSchema, timeoutMs: 1500 });
      return d.category;
    } catch {
      return '*';
    }
  }

  // ───────────────────────────────────────────── buyer: read
  async mine(p: PrincipalInfo) {
    const rows = await this.db.query(
      `SELECT rr.id AS return_id, c.id AS case_id, rr.order_no, c.status, c.requested_minor, c.approved_minor, rr.created_at
         FROM return_requests rr JOIN refund_cases c ON c.return_request_id = rr.id WHERE rr.buyer_id = $1 ORDER BY rr.created_at DESC LIMIT 50`,
      [p.sub],
    );
    return MyReturnsSchema.parse({
      currency: CURRENCY,
      items: rows.map((r: any) => ({
        returnId: r.return_id, caseId: r.case_id, orderNo: r.order_no, status: r.status, statusText: STATUS_TEXT[r.status as CaseStatus],
        requestedMinor: n(r.requested_minor), approvedMinor: r.approved_minor === null ? null : n(r.approved_minor), openedAt: iso(r.created_at),
      })),
    });
  }

  private async ownReturn(p: PrincipalInfo, returnId: string, tx: EntityManager | DataSource = this.db) {
    const [rr] = await tx.query(`SELECT * FROM return_requests WHERE id = $1`, [returnId]);
    if (!rr || (rr.buyer_id !== p.sub && !p.roles.some((r) => STAFF.includes(r)))) throw new NotFoundException('return not found');
    const [c] = await tx.query(`SELECT * FROM refund_cases WHERE return_request_id = $1`, [returnId]);
    return { rr, c };
  }

  async view(p: PrincipalInfo, returnId: string) {
    const { rr, c } = await this.ownReturn(p, returnId);
    const items = await this.db.query(`SELECT * FROM return_items WHERE return_request_id = $1 ORDER BY title`, [returnId]);
    const evidence = await this.evidenceOf(this.db, c.id);
    const hist = await this.db.query(`SELECT to_status, at FROM decisions WHERE case_id = $1 AND to_status IS NOT NULL ORDER BY at, id`, [c.id]);
    const photos = evidence.filter((e) => e.kind === 'PHOTO').length;
    const timeline: { status: string; at: string; text: string }[] = [];
    for (const h of hist) {
      const s = h.to_status as CaseStatus;
      if (timeline.at(-1)?.status === s) continue;
      timeline.push({ status: s, at: iso(h.at)!, text: STATUS_TEXT[s] ?? s });
    }
    return ReturnViewSchema.parse({
      currency: CURRENCY,
      returnId,
      caseId: c.id,
      orderId: rr.order_id,
      orderNo: rr.order_no,
      reasonCode: rr.reason_code,
      status: c.status,
      statusText: STATUS_TEXT[c.status as CaseStatus],
      requestedMinor: n(c.requested_minor),
      approvedMinor: c.approved_minor === null ? null : n(c.approved_minor),
      resolution: c.resolution ?? null,
      lines: items.map((i: any) => ({ productId: i.product_id, title: i.title, qty: i.qty, unitPriceMinor: n(i.unit_price_minor) })),
      evidence: evidence.filter((e) => e.kind === 'PHOTO'),
      explanation: c.explanation ?? null,
      canAddPhoto: ['REQUESTED', 'GATHERING_EVIDENCE', 'AWAITING_BUYER', 'PROPOSED', 'PENDING_HUMAN', 'APPEALED'].includes(c.status) && photos < MAX_PHOTOS_PER_CASE,
      canAppeal: c.status === 'REJECTED' && !rr.appeal_note,
      timeline,
      openedAt: iso(rr.created_at),
    });
  }

  // ───────────────────────────────────────────── buyer: evidence + appeal
  async addPhoto(p: PrincipalInfo, returnId: string, file: Buffer) {
    const { rr, c } = await this.ownReturn(p, returnId);
    if (rr.buyer_id !== p.sub) throw new ForbiddenException('only the buyer can add photos');
    const [{ photos }] = await this.db.query(`SELECT count(*) AS photos FROM evidence WHERE case_id = $1 AND kind = 'PHOTO'`, [c.id]);
    if (n(photos) >= MAX_PHOTOS_PER_CASE) throw new UnprocessableEntityException({ code: 'TOO_MANY', message: `At most ${MAX_PHOTOS_PER_CASE} photos per return.` });
    if (!['REQUESTED', 'GATHERING_EVIDENCE', 'AWAITING_BUYER', 'PROPOSED', 'PENDING_HUMAN', 'APPEALED'].includes(c.status))
      throw new ConflictException({ message: 'Photos can no longer be added to this return.' });
    let img;
    try {
      img = await processEvidence(file);
    } catch (e) {
      if (e instanceof EvidenceError) throw new HttpException({ code: e.code, message: e.message }, e.code === 'TOO_LARGE' ? 413 : 422);
      throw e;
    }
    // reused-photo signal: near-identical hash on another case (any buyer)
    const others = await this.db.query(`SELECT case_id, findings->>'dhash' AS h FROM evidence WHERE kind = 'PHOTO' AND case_id <> $1 AND findings ? 'dhash' ORDER BY created_at DESC LIMIT 5000`, [c.id]);
    const dup = others.find((o: any) => o.h && hamming(o.h, img.dhash) <= 4);
    const id = randomUUID();
    const prefix = `cases/${c.id}/${id}`;
    if (!this.store.configured) throw new HttpException({ message: 'photo storage is not configured' }, 503);
    await this.store.put(`${prefix}/full.webp`, img.full);
    await this.store.put(`${prefix}/thumb.webp`, img.thumb);
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO evidence (id, case_id, kind, object_prefix, findings, uploaded_by) VALUES ($1,$2,'PHOTO',$3,$4,$5)`, [
        id, c.id, prefix, JSON.stringify({ width: img.width, height: img.height, dhash: img.dhash, hadExif: img.hadExif, duplicateOf: dup?.case_id ?? null, signals: dup ? ['reused_photo'] : [] }), `user:${p.sub}`,
      ]);
      if (dup) await tx.query(`UPDATE return_requests SET signals = signals || '["reused_photo"]'::jsonb WHERE id = $1 AND NOT signals ? 'reused_photo'`, [returnId]);
      const cur = await this.lockCase(tx, c.id);
      if (cur.status === 'AWAITING_BUYER') await this.transition(tx, cur, 'PENDING_HUMAN', `user:${p.sub}`, { outcome: 'EVIDENCE_ADDED', note: 'buyer added a photo' });
      else await this.history(tx, c.id, `user:${p.sub}`, 'EVIDENCE_ADDED', null, null, null, null);
    });
    return this.view(p, returnId);
  }

  async appeal(p: PrincipalInfo, returnId: string, note: string) {
    const { rr, c } = await this.ownReturn(p, returnId);
    if (rr.buyer_id !== p.sub) throw new ForbiddenException('only the buyer can appeal');
    if (c.status !== 'REJECTED' || rr.appeal_note) throw new ConflictException({ message: 'This return cannot be appealed.' });
    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE return_requests SET appeal_note = $2 WHERE id = $1`, [returnId, note]);
      let cur = await this.lockCase(tx, c.id);
      cur = await this.transition(tx, cur, 'APPEALED', `user:${p.sub}`, { outcome: 'APPEAL', note });
      await this.transition(tx, cur, 'PENDING_HUMAN', 'system', { outcome: 'ROUTE', note: 'appeal → reviewer', set: { required_role: 'support', resolved_at: null, decided_by: null } });
    });
    return this.view(p, returnId);
  }

  async evidenceImage(p: PrincipalInfo, evidenceId: string, size: 'full' | 'thumb') {
    const [e] = await this.db.query(
      `SELECT e.object_prefix, rr.buyer_id FROM evidence e JOIN refund_cases c ON c.id = e.case_id LEFT JOIN return_requests rr ON rr.id = c.return_request_id WHERE e.id = $1 AND e.kind = 'PHOTO'`,
      [evidenceId],
    );
    if (!e || (e.buyer_id !== p.sub && !p.roles.some((r) => STAFF.includes(r)))) throw new NotFoundException('photo not found');
    const obj = await this.store.get(`${e.object_prefix}/${size}.webp`);
    if (!obj) throw new NotFoundException('photo not found');
    return obj;
  }

  // ───────────────────────────────────────────── internal (agent)
  async context(caseId: string) {
    const c = await this.caseRow(this.db, caseId);
    return this.buildContext(this.db, c);
  }

  async policyEval(caseId: string, riskScore: number, signals: string[]) {
    const c = await this.caseRow(this.db, caseId);
    const ctx = await this.buildContext(this.db, c);
    const own = await this.signalsOf(this.db, c);
    return PolicyResultSchema.parse(evaluatePolicy(this.policyInput(ctx), riskScore, [...new Set([...signals, ...own])], await this.rules()));
  }

  async proposal(p: PrincipalInfo, caseId: string, input: ProposalInput) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockCase(tx, caseId);
      const ctx = await this.buildContext(tx, c);
      const own = await this.signalsOf(tx, c);
      const local = localRisk({ requestedMinor: n(c.requested_minor), reasonCode: c.reason, carrierStatus: ctx.tracking.carrierStatus, buyerHistory: ctx.buyerHistory }, own);
      // the service re-evaluates policy itself — never trusts the agent's claims; risk = the higher of both views
      const risk = Math.max(input.riskScore, local);
      const pol = evaluatePolicy(this.policyInput(ctx), risk, [...new Set([...input.rationale.signals, ...own])], await this.rules(tx));
      const violations: string[] = [];
      if (!pol.allowedOutcomes.includes(input.outcome) && !(input.outcome === 'REJECT' && !pol.hardReject)) violations.push(`outcome ${input.outcome} not allowed (${pol.allowedOutcomes.join(', ')})`);
      if (input.amountMinor > pol.refundableMinor) violations.push(`amount ${input.amountMinor} > refundable ${pol.refundableMinor}`);
      if (input.outcome === 'REJECT' && input.amountMinor !== 0) violations.push('a rejection has amount 0');
      const valid = violations.length === 0;
      if (!valid && input.mode !== 'SHADOW') throw new UnprocessableEntityException({ code: 'INVALID_PROPOSAL', message: violations.join('; '), violations });
      if (input.mode !== 'SHADOW' && input.version !== c.version) throw new ConflictException({ message: `case changed (version ${c.version}, proposal for ${input.version})` });

      const id = randomUUID();
      const ins = rowsOf(
        await tx.query(
          `INSERT INTO proposals (id, case_id, run_id, mode, outcome, amount_minor, confidence, risk_score, policy_version, rationale, actor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (case_id, run_id) DO NOTHING RETURNING id`,
          [id, caseId, input.runId, input.mode, input.outcome, input.amountMinor, input.confidence, input.riskScore, input.policyVersion, JSON.stringify({ ...input.rationale, valid, violations, serverRisk: risk }), p.actor ?? `service:${p.sub}`],
        ),
      );
      if (!ins.length) return { proposalId: null, duplicate: true, caseStatus: c.status, valid, violations };
      await this.outbox.enqueue(tx, {
        topic: TOPICS.returns, type: 'returns.case_proposed.v1', aggregateId: caseId,
        data: { caseId, orderId: c.order_id, mode: input.mode, outcome: input.outcome, amountMinor: input.amountMinor, confidence: input.confidence, runId: input.runId },
      });
      let status: CaseStatus = c.status;
      if (input.mode !== 'SHADOW') {
        await tx.query(`UPDATE refund_cases SET agent_run_id = $2, proposed_minor = $3, agent_rationale = $4 WHERE id = $1`, [caseId, input.runId, input.amountMinor, input.rationale.summary]);
        let cur = { ...c, proposed_minor: input.amountMinor };
        const untouched = !(await this.humanActed(tx, caseId));
        const actor = p.actor ?? 'agent:refund';
        if (cur.status === 'REQUESTED' || cur.status === 'GATHERING_EVIDENCE') cur = await this.transition(tx, cur, 'PROPOSED', actor, { outcome: input.outcome, amount: input.amountMinor, rationale: input.rationale });
        const canAuto = input.mode === 'LIVE' && untouched && pol.autoEligible && MONEY_OUTCOMES.includes(input.outcome) && input.confidence >= 0.8;
        if (canAuto && (cur.status === 'PROPOSED' || cur.status === 'PENDING_HUMAN')) {
          cur = await this.transition(tx, cur, 'AUTO_APPROVED', actor, {
            outcome: input.outcome, amount: input.amountMinor, rationale: input.rationale,
            set: { resolution: input.outcome, approved_minor: input.amountMinor, decided_by: 'agent', policy: pol, policy_version: pol.policyVersion, risk_score: risk, required_role: null, explanation: input.rationale.buyerExplanation },
          });
          await this.decided(tx, caseId, input.outcome, input.amountMinor, 'agent', 'AUTO_APPROVED');
        } else if (cur.status === 'PROPOSED') {
          cur = await this.transition(tx, cur, 'PENDING_HUMAN', 'system', { outcome: 'ROUTE', note: 'agent proposal → reviewer', set: { required_role: 'support', policy: pol, dual_control: pol.dualControl } });
        }
        status = cur.status;
      }
      return { proposalId: id, duplicate: false, caseStatus: status, valid, violations };
    });
  }

  async requestEvidence(p: PrincipalInfo, caseId: string, message: string, runId: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockCase(tx, caseId);
      if (await this.humanActed(tx, caseId)) throw new ConflictException({ message: 'a person already handles this case' });
      const cur = await this.transition(tx, c, 'AWAITING_BUYER', p.actor ?? 'agent:refund', { outcome: 'REQUEST_EVIDENCE', note: message, rationale: { runId } });
      return { caseId, status: cur.status };
    });
  }

  /** MONEY: refund through payment. Idempotent per case; only AUTO_APPROVED / APPROVED (or FAILED retry). */
  async execute(caseId: string, amountMinor: number | null, actor: string) {
    const prep = await this.db.transaction(async (tx) => {
      const c = await this.lockCase(tx, caseId);
      const what = executeDecision(c.status);
      if (what === 'already') return { done: true as const, c };
      if (what === 'refuse') throw new ConflictException({ message: `case is ${c.status}; only approved cases can be executed` });
      // non-money outcomes (replacement, store credit) close the case — no payment involved
      if (!MONEY_OUTCOMES.includes(c.resolution as Resolution)) {
        const closed = await this.transition(tx, c, 'CLOSED', actor, { outcome: c.resolution ?? 'CLOSE', note: closeNote(c.resolution), set: { resolved_at: new Date() } });
        return { done: true as const, c: closed };
      }
      const approved = c.approved_minor === null ? null : n(c.approved_minor);
      const amount = amountMinor ?? approved ?? 0;
      const refundable = await this.refundableOf(tx, c);
      try {
        assertRefundable(amount, approved, refundable);
      } catch (e) {
        httpOf(e);
      }
      const cur = await this.transition(tx, c, 'REFUND_PENDING', actor, { outcome: 'EXECUTE', amount });
      await this.outbox.enqueue(tx, { topic: TOPICS.returns, type: 'returns.refund_executed.v1', aggregateId: caseId, data: { caseId, orderId: c.order_id, amountMinor: amount, refundId: null, status: 'REFUND_PENDING' } });
      return { done: false as const, c: cur, amount };
    });
    if (prep.done) return this.executionResult(prep.c);
    const c = prep.c;
    try {
      const r = await this.svc.call('payment', 'POST', '/internal/refunds', {
        body: { refundCaseId: caseId, orderId: c.order_id, amountMinor: prep.amount, reason: `return ${c.reason.toLowerCase()} (${actor})`.slice(0, 200) },
        idempotencyKey: `refund:${caseId}`,
        timeoutMs: 5000,
      });
      await this.db.query(`UPDATE refund_cases SET refund_id = $2 WHERE id = $1 AND refund_id IS NULL`, [caseId, r?.refundId ?? null]);
    } catch (e) {
      const why = e instanceof DependencyError ? `${e.status || e.reason}: ${JSON.stringify(e.body ?? e.message).slice(0, 200)}` : (e as Error).message;
      this.log.warn(`refund for case ${caseId} failed: ${why}`);
      await this.db.transaction(async (tx) => {
        const cur = await this.lockCase(tx, caseId);
        if (cur.status !== 'REFUND_PENDING') return;
        await this.transition(tx, cur, 'FAILED', 'system', { outcome: 'REFUND_FAILED', note: why });
        await this.outbox.enqueue(tx, { topic: TOPICS.returns, type: 'returns.refund_executed.v1', aggregateId: caseId, data: { caseId, orderId: cur.order_id, amountMinor: prep.amount, refundId: null, status: 'FAILED' } });
      });
    }
    return this.executionResult(await this.caseRow(this.db, caseId));
  }

  private executionResult(c: any) {
    return { caseId: c.id, status: c.status as CaseStatus, amountMinor: c.approved_minor === null ? null : n(c.approved_minor), refundId: c.refund_id ?? null };
  }

  /** payment.refunded.v1 → REFUNDED (match by refundId, else the order's case waiting for that amount). */
  async onRefunded(tx: EntityManager, d: { refundId: string; orderId: string; amount: { amountMinor: number } }) {
    let [c] = await tx.query(`SELECT * FROM refund_cases WHERE refund_id = $1 FOR UPDATE`, [d.refundId]);
    if (!c) [c] = await tx.query(`SELECT * FROM refund_cases WHERE order_id = $1 AND status = 'REFUND_PENDING' AND approved_minor = $2 ORDER BY updated_at LIMIT 1 FOR UPDATE`, [d.orderId, d.amount.amountMinor]);
    if (!c || c.status !== 'REFUND_PENDING') return;
    await tx.query(`UPDATE refund_cases SET refund_id = coalesce(refund_id, $2) WHERE id = $1`, [c.id, d.refundId]);
    await this.transition(tx, c, 'REFUNDED', 'payment', { outcome: 'REFUNDED', amount: d.amount.amountMinor, set: { resolved_at: new Date() } });
    await this.outbox.enqueue(tx, { topic: TOPICS.returns, type: 'returns.refund_executed.v1', aggregateId: c.id, data: { caseId: c.id, orderId: c.order_id, amountMinor: d.amount.amountMinor, refundId: d.refundId, status: 'REFUNDED' } });
  }

  // ───────────────────────────────────────────── staff
  async queue(role?: string) {
    if (role && role !== 'support' && role !== 'finance') throw new BadRequestException('role must be support or finance');
    const rows = await this.db.query(
      `SELECT * FROM refund_cases WHERE status = 'PENDING_HUMAN' ${role ? `AND coalesce(required_role, 'support') = '${role}'` : ''} ORDER BY opened_at ASC LIMIT 100`,
    );
    return CaseQueueSchema.parse({
      currency: CURRENCY,
      items: rows.map((c: any) => ({
        caseId: c.id, orderNo: c.order_no, status: c.status, version: c.version, reasonCode: c.reason, requestedMinor: n(c.requested_minor),
        riskScore: c.risk_score === null ? null : n(c.risk_score), requiredRole: c.required_role ?? null, dualControl: Boolean(c.dual_control) || n(c.requested_minor) > POLICY_V1.dualControlMinor, openedAt: iso(c.opened_at),
      })),
    });
  }

  async detail(p: PrincipalInfo, caseId: string) {
    const c = await this.caseRow(this.db, caseId);
    const evidence = await this.evidenceOf(this.db, caseId);
    const decisions = await this.db.query(`SELECT * FROM decisions WHERE case_id = $1 ORDER BY at, id`, [caseId]);
    const [prop] = await this.db.query(`SELECT * FROM proposals WHERE case_id = $1 ORDER BY created_at DESC LIMIT 1`, [caseId]);
    const showProposal = prop && (p.roles.includes('admin') || prop.mode !== 'SHADOW');
    const refundable = await this.refundableOf(this.db, c);
    const items = c.return_request_id ? await this.db.query(`SELECT * FROM return_items WHERE return_request_id = $1 ORDER BY title`, [c.return_request_id]) : [];
    return CaseDetailSchema.parse({
      currency: CURRENCY,
      caseId,
      returnId: c.return_request_id ?? null,
      orderNo: c.order_no,
      status: c.status,
      version: c.version,
      reasonCode: c.reason,
      buyerText: c.buyer_text ?? null,
      requestedMinor: n(c.requested_minor),
      approvedMinor: c.approved_minor === null ? null : n(c.approved_minor),
      refundableMinor: refundable,
      riskScore: c.risk_score === null ? null : n(c.risk_score),
      requiredRole: c.required_role ?? null,
      dualControl: Boolean(c.dual_control) || n(c.requested_minor) > POLICY_V1.dualControlMinor,
      policy: c.policy ?? null,
      lines: items.map((i: any) => ({ productId: i.product_id, title: i.title, category: i.category ?? null, qty: i.qty, unitPriceMinor: n(i.unit_price_minor) })),
      evidence,
      agentProposal: showProposal
        ? {
            runId: prop.run_id, mode: prop.mode, outcome: prop.outcome, amountMinor: n(prop.amount_minor), confidence: n(prop.confidence), riskScore: n(prop.risk_score), policyVersion: prop.policy_version,
            rationale: { summary: prop.rationale.summary ?? '', buyerExplanation: prop.rationale.buyerExplanation ?? '', ruleHits: prop.rationale.ruleHits ?? [], evidenceIds: prop.rationale.evidenceIds ?? [], signals: prop.rationale.signals ?? [], model: prop.rationale.model ?? '' },
            at: iso(prop.created_at),
          }
        : null,
      decisions: decisions.map((d: any) => ({ actor: d.actor, outcome: d.outcome, amountMinor: d.amount_minor === null ? null : n(d.amount_minor), note: d.note ?? null, at: iso(d.at) })),
      openedAt: iso(c.opened_at),
    });
  }

  async approve(p: PrincipalInfo, caseId: string, body: { outcome: Resolution; amountMinor: number; note: string; version: number }) {
    const actor = `user:${p.name ?? p.sub}`;
    const res = await this.db.transaction(async (tx) => {
      const c = await this.lockCase(tx, caseId);
      if (c.version !== body.version) throw new ConflictException({ message: 'The case changed since you opened it — reload.' });
      const rules = await this.rules(tx);
      let step;
      try {
        step = approvalStep({ status: c.status, requiredRole: c.required_role, dualControl: Boolean(c.dual_control), firstApprover: c.first_approver }, { sub: p.sub, roles: p.roles }, body.amountMinor, rules.dualControlMinor);
      } catch (e) {
        httpOf(e);
      }
      // policy guard (humans may override a hard rule only on an appealed case, with a note)
      const pol: PolicyResult | null = c.policy ?? null;
      const appealed = await this.wasAppealed(tx, caseId);
      if (pol && !pol.allowedOutcomes.includes(body.outcome) && !(appealed && body.note.length >= 5))
        throw new UnprocessableEntityException({ message: `outcome ${body.outcome} is outside the policy (${pol.allowedOutcomes.join(', ')})${appealed ? ' — add a note to override on appeal' : ''}` });
      if (MONEY_OUTCOMES.includes(body.outcome)) {
        try {
          assertRefundable(body.amountMinor, c.first_approval ? n(c.first_approval.amountMinor) : null, await this.refundableOf(tx, c));
        } catch (e) {
          httpOf(e);
        }
      }
      if (step.kind === 'first') {
        const upd = rowsOf(
          await tx.query(
            `UPDATE refund_cases SET first_approver = $3, first_approval = $4, required_role = 'finance', dual_control = true, version = version + 1, updated_at = now()
              WHERE id = $1 AND version = $2 RETURNING *`,
            [caseId, c.version, p.sub, JSON.stringify({ outcome: body.outcome, amountMinor: body.amountMinor, note: body.note, by: actor, at: new Date().toISOString() })],
          ),
        );
        if (!upd.length) throw new ConflictException({ message: 'The case changed — reload.' });
        await this.history(tx, caseId, actor, 'APPROVE_1_OF_2', body.amountMinor, body.note, 'PENDING_HUMAN', 'PENDING_HUMAN');
        return { kind: 'first' as const };
      }
      const explanation = buyerText(body.outcome, body.amountMinor);
      await this.transition(tx, c, 'APPROVED', actor, {
        outcome: body.outcome, amount: body.amountMinor, note: body.note,
        set: { resolution: body.outcome, approved_minor: body.amountMinor, decided_by: 'human', required_role: null, decision_note: body.note || null, explanation },
      });
      await this.decided(tx, caseId, body.outcome, body.amountMinor, 'human', 'APPROVED');
      return { kind: 'final' as const };
    });
    if (res.kind === 'final') await this.execute(caseId, body.amountMinor, actor);
    return this.detail(p, caseId);
  }

  async reject(p: PrincipalInfo, caseId: string, body: { note: string; version: number }) {
    const actor = `user:${p.name ?? p.sub}`;
    await this.db.transaction(async (tx) => {
      const c = await this.lockCase(tx, caseId);
      if (c.version !== body.version) throw new ConflictException({ message: 'The case changed since you opened it — reload.' });
      if (c.status !== 'PENDING_HUMAN') throw new ConflictException({ message: `case is ${c.status}, not waiting for a decision` });
      const role = c.required_role ?? 'support';
      if (!p.roles.includes(role) && !p.roles.includes('admin')) throw new ForbiddenException(`this step needs the ${role} role`);
      await this.transition(tx, c, 'REJECTED', actor, {
        outcome: 'REJECT', note: body.note,
        set: { resolution: 'REJECT', approved_minor: 0, decided_by: 'human', resolved_at: new Date(), required_role: null, decision_note: body.note, explanation: `We couldn't approve this return: ${body.note}` },
      });
      await this.decided(tx, caseId, 'REJECT', 0, 'human', 'REJECTED');
    });
    return this.detail(p, caseId);
  }

  async shadowReport(days: number) {
    const rows = await this.db.query(
      `SELECT c.id, c.order_no, c.reason, c.status, c.resolution, c.approved_minor, p.outcome AS a_outcome, p.amount_minor AS a_amount
         FROM refund_cases c
         LEFT JOIN LATERAL (SELECT * FROM proposals WHERE case_id = c.id AND mode = 'SHADOW' ORDER BY created_at DESC LIMIT 1) p ON true
        WHERE c.decided_by = 'human' AND c.status IN ('APPROVED','REFUND_PENDING','REFUNDED','REJECTED','CLOSED','FAILED')
          AND coalesce(c.resolved_at, c.updated_at) > now() - make_interval(days => $1)`,
      [days],
    );
    const withP = rows.filter((r: any) => r.a_outcome);
    const human = (r: any) => (r.status === 'REJECTED' ? 'REJECT' : (r.resolution ?? 'REFUND'));
    const humanAmt = (r: any) => (r.status === 'REJECTED' ? 0 : r.approved_minor === null ? null : n(r.approved_minor));
    const outcomeOk = (r: any) => r.a_outcome === human(r);
    const amountOk = (r: any) => {
      const h = humanAmt(r) ?? 0;
      return Math.abs(n(r.a_amount) - h) <= Math.max(1, Math.round(h * 0.05));
    };
    const reasons = [...new Set(withP.map((r: any) => r.reason))] as ReasonCode[];
    return ShadowReportSchema.parse({
      days,
      decidedCases: rows.length,
      withProposal: withP.length,
      outcomeAgreement: withP.length ? round3(withP.filter(outcomeOk).length / withP.length) : 0,
      amountAgreement: withP.length ? round3(withP.filter(amountOk).length / withP.length) : 0,
      byReason: reasons.sort().map((reasonCode) => {
        const g = withP.filter((r: any) => r.reason === reasonCode);
        return { reasonCode, cases: g.length, agreement: round3(g.filter(outcomeOk).length / g.length) };
      }),
      disagreements: withP
        .filter((r: any) => !outcomeOk(r) || !amountOk(r))
        .slice(0, 25)
        .map((r: any) => ({ caseId: r.id, orderNo: r.order_no, agentOutcome: r.a_outcome, humanOutcome: human(r), agentAmountMinor: n(r.a_amount), humanAmountMinor: humanAmt(r) })),
    });
  }

  // ───────────────────────────────────────────── helpers
  private async caseRow(tx: EntityManager | DataSource, id: string) {
    const [c] = await tx.query(`SELECT * FROM refund_cases WHERE id = $1`, [id]);
    if (!c) throw new NotFoundException('case not found');
    return c;
  }
  private async lockCase(tx: EntityManager, id: string) {
    const [c] = await tx.query(`SELECT * FROM refund_cases WHERE id = $1 FOR UPDATE`, [id]);
    if (!c) throw new NotFoundException('case not found');
    return c;
  }
  /** captured − refunded by other cases on the order; legacy demo cases (no request snapshot) → their requested amount */
  private async refundableOf(tx: EntityManager | DataSource, c: any) {
    if (!c.return_request_id) return n(c.requested_minor);
    const ctx = await this.buildContext(tx, c);
    return Math.max(0, ctx.order.capturedMinor - ctx.order.refundedMinor);
  }
  private async humanActed(tx: EntityManager, caseId: string) {
    const [r] = await tx.query(`SELECT 1 FROM decisions WHERE case_id = $1 AND actor LIKE 'user:%' AND outcome NOT IN ('REQUESTED','EVIDENCE_ADDED','APPEAL') LIMIT 1`, [caseId]);
    return Boolean(r);
  }
  private async wasAppealed(tx: EntityManager, caseId: string) {
    const [r] = await tx.query(`SELECT 1 FROM decisions WHERE case_id = $1 AND outcome = 'APPEAL' LIMIT 1`, [caseId]);
    return Boolean(r);
  }
  private async signalsOf(tx: EntityManager | DataSource, c: any): Promise<string[]> {
    if (!c.return_request_id) return [];
    const [rr] = await tx.query(`SELECT signals FROM return_requests WHERE id = $1`, [c.return_request_id]);
    return (rr?.signals as string[]) ?? [];
  }

  private async evidenceOf(tx: EntityManager | DataSource, caseId: string): Promise<{ evidenceId: string; kind: string; hasImage: boolean; findings: Record<string, unknown> | null; at: string }[]> {
    const rows = await tx.query(`SELECT * FROM evidence WHERE case_id = $1 ORDER BY created_at`, [caseId]);
    return rows.map((e: any) => ({ evidenceId: e.id, kind: e.kind, hasImage: e.kind === 'PHOTO' && !!e.object_prefix, findings: e.findings ?? null, at: iso(e.created_at)! }));
  }

  private addFact(tx: EntityManager, caseId: string, kind: string, findings: unknown, by: string) {
    return tx.query(`INSERT INTO evidence (id, case_id, kind, findings, uploaded_by) VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), caseId, kind, JSON.stringify(findings), by]);
  }

  private history(tx: EntityManager, caseId: string, actor: string, outcome: string, amount: number | null, note: string | null, from: string | null, to: string | null, rationale?: unknown) {
    return tx.query(`INSERT INTO decisions (case_id, actor, outcome, amount_minor, note, from_status, to_status, rationale) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      caseId, actor, outcome, amount, note, from, to, rationale === undefined ? null : JSON.stringify(rationale),
    ]);
  }

  /** Versioned, checked transition + history row. `set` columns are written in the same UPDATE. */
  private async transition(tx: EntityManager, c: any, to: CaseStatus, actor: string, o: { outcome: string; amount?: number; note?: string; rationale?: unknown; set?: Record<string, unknown> }) {
    try {
      assertTransition(c.status, to);
    } catch (e) {
      httpOf(e);
    }
    const set = o.set ?? {};
    const cols = Object.keys(set);
    const vals = cols.map((k) => (set[k] !== null && typeof set[k] === 'object' && !(set[k] instanceof Date) ? JSON.stringify(set[k]) : set[k]));
    const assign = cols.map((k, i) => `${k} = $${i + 4}`).join(', ');
    const upd = rowsOf(
      await tx.query(`UPDATE refund_cases SET status = $3, version = version + 1, updated_at = now()${assign ? `, ${assign}` : ''} WHERE id = $1 AND version = $2 RETURNING *`, [c.id, c.version, to, ...vals]),
    );
    if (!upd.length) throw new ConflictException({ message: 'The case changed — reload.' });
    await this.history(tx, c.id, actor, o.outcome, o.amount ?? null, o.note ?? null, c.status, to, o.rationale);
    return upd[0];
  }

  private async decided(tx: EntityManager, caseId: string, outcome: string, amountMinor: number, decidedBy: 'agent' | 'human' | 'policy', status: string) {
    const [c] = await tx.query(`SELECT order_id, order_no, buyer_id, seller_id FROM refund_cases WHERE id = $1`, [caseId]);
    await this.outbox.enqueue(tx, {
      topic: TOPICS.returns, type: 'returns.case_decided.v1', aggregateId: caseId,
      data: { caseId, orderId: c.order_id, orderNo: c.order_no, buyerId: c.buyer_id, sellerId: c.seller_id, outcome, amountMinor, decidedBy, status },
    });
  }

  /** Everything the agent may see — from the snapshot taken at request time + live case data (data-minimised). */
  async buildContext(tx: EntityManager | DataSource, c: any): Promise<CaseContext> {
    if (!c.return_request_id) throw new UnprocessableEntityException({ message: 'legacy case without a return request (demo data) — no agent context' });
    const [rr] = await tx.query(`SELECT * FROM return_requests WHERE id = $1`, [c.return_request_id]);
    const items = await tx.query(`SELECT * FROM return_items WHERE return_request_id = $1 ORDER BY title`, [rr.id]);
    const s = rr.snapshot as Snapshot;
    const [h] = await tx.query(
      `SELECT count(*) FILTER (WHERE status IN ('AUTO_APPROVED','APPROVED','REFUND_PENDING','REFUNDED') AND opened_at > now() - interval '90 days') AS r90,
              count(*) FILTER (WHERE status IN ('AUTO_APPROVED','APPROVED','REFUND_PENDING','REFUNDED') AND opened_at > now() - interval '180 days') AS r180
         FROM refund_cases WHERE buyer_id = $1 AND id <> $2`,
      [rr.buyer_id, c.id],
    );
    const [rf] = await tx.query(
      `SELECT coalesce(sum(approved_minor), 0) AS refunded FROM refund_cases WHERE order_id = $1 AND id <> $2 AND status IN ('REFUND_PENDING','REFUNDED')`,
      [c.order_id, c.id],
    );
    const evidence = await this.evidenceOf(tx, c.id);
    return CaseContextSchema.parse({
      currency: CURRENCY,
      caseId: c.id,
      returnId: rr.id,
      status: c.status,
      version: c.version,
      claim: {
        reasonCode: rr.reason_code, buyerText: rr.buyer_text, preferred: rr.preferred,
        lines: items.map((i: any) => ({ productId: i.product_id, title: i.title, category: i.category, qty: i.qty, unitPriceMinor: n(i.unit_price_minor) })),
      },
      order: {
        orderId: rr.order_id, orderNo: rr.order_no, status: s.orderStatus, placedAt: s.placedAt, deliveredAt: s.deliveredAt, shippedAt: s.shippedAt,
        city: s.city, pincode: s.pincode, totalMinor: s.totalMinor, capturedMinor: s.capturedMinor, refundedMinor: n(rf.refunded), sellerId: s.sellerId, sellerName: s.sellerName,
      },
      tracking: { carrier: s.carrier, trackingNo: s.trackingNo, carrierStatus: carrierStatusOf(s.sellerOrderStatus) },
      buyerHistory: { refunds90d: n(h.r90), refundRate180d: s.orders180d ? Math.min(1, round3(n(h.r180) / s.orders180d)) : n(h.r180) > 0 ? 1 : 0, orders180d: s.orders180d, accountAgeDays: null },
      evidence,
      requestedMinor: n(c.requested_minor),
    });
  }

  policyInput(ctx: CaseContext): PolicyInput {
    return {
      reasonCode: ctx.claim.reasonCode,
      lines: ctx.claim.lines,
      requestedMinor: ctx.requestedMinor,
      deliveredAt: ctx.order.deliveredAt ? new Date(ctx.order.deliveredAt) : null,
      carrierStatus: ctx.tracking.carrierStatus,
      photos: ctx.evidence.filter((e) => e.kind === 'PHOTO').length,
      buyerHistory: ctx.buyerHistory,
      capturedMinor: ctx.order.capturedMinor,
      refundedMinor: ctx.order.refundedMinor,
      now: new Date(),
    };
  }
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
function buyerText(outcome: Resolution, amount: number) {
  if (outcome === 'REFUND' || outcome === 'PARTIAL_REFUND') return `Approved: a refund of ${inr(amount)} to your original payment method.`;
  if (outcome === 'STORE_CREDIT') return `Approved: ${inr(amount)} store credit.`;
  if (outcome === 'REPLACEMENT') return 'Approved: the seller will send a replacement.';
  return 'Decision recorded.';
}
function closeNote(resolution: string | null) {
  if (resolution === 'STORE_CREDIT') return 'store credit recorded (wallet not built yet — issued manually by support)';
  if (resolution === 'REPLACEMENT') return 'replacement to be dispatched by the seller (replacement orders not built yet)';
  return 'closed';
}
