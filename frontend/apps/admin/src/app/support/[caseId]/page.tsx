import { hasRole, load } from '@ac/bff';
import { CaseDetailSchema, productImageUrl } from '@ac/contracts';
import { Field, fmtMoney, Notice, Panel, ProductImage, StatusBadge, SubmitButton, Textarea, Unavailable } from '@ac/ui';
import { requireRoles, StaffFrame } from '../../../lib/guard';
import { caseLabel, caseTone, OPEN, OUTCOME, REASON, riskTone, UUID } from '../../../lib/refunds';
import { approveCase, rejectCase } from './actions';
import { ApproveForm } from './approve-form';

export const dynamic = 'force-dynamic';
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** One refund case for support (first decision) and finance (second approval under dual control). */
export default async function CasePage({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { caseId } = await params;
  const sp = await searchParams;
  const g = await requireRoles(`/admin/support/${caseId}`, ['support', 'finance', 'admin']);
  if ('denied' in g) return g.denied;
  const session = g.session;
  const current = hasRole(session, 'support', 'admin') ? '/admin/support' : '/admin/finance';
  const frame = (children: React.ReactNode, title = 'Refund case') => (
    <StaffFrame session={session} current={current} title={title}>
      {children}
    </StaffFrame>
  );
  if (!UUID.test(caseId)) return frame(<Notice tone="error">Unknown case.</Notice>);
  const d = await load(CaseDetailSchema, `/api/returns/v1/refund-cases/${caseId}`);
  if (!d.ok) return frame(d.status === 404 ? <Notice tone="error" title="Case not found">This case doesn’t exist or was removed.</Notice> : <Unavailable what="Returns service" reason={d.error} />);
  const c = d.data;
  const cur = c.currency;
  const p = c.policy;
  const open = OPEN.includes(c.status);
  const needRole = c.requiredRole ?? 'support';
  const mayDecide = open && (hasRole(session, 'admin') || hasRole(session, needRole));
  const outcomes = (p?.allowedOutcomes ?? ['REFUND', 'PARTIAL_REFUND', 'STORE_CREDIT', 'REPLACEMENT']).filter((o) => o !== 'REJECT');
  const hardReject = !!p?.hardReject;
  const secondApproval = c.dualControl && needRole === 'finance';

  return frame(
    <>
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.err && <Notice tone="error">{sp.err}</Notice>}
      <header className="flex flex-wrap items-center gap-2 text-[14px]">
        <a className="text-[var(--link)] hover:underline" href={current}>
          ← Back to queue
        </a>
        <span className="text-[var(--muted)]">·</span>
        <span>
          Order <strong>{c.orderNo}</strong> · {REASON[c.reasonCode] ?? c.reasonCode} · opened {when(c.openedAt)}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <StatusBadge tone={caseTone(c.status)}>{caseLabel(c.status)}</StatusBadge>
          {c.dualControl && <StatusBadge tone="warning">dual control: support + finance</StatusBadge>}
          {c.riskScore !== null && <StatusBadge tone={riskTone(c.riskScore)}>risk {c.riskScore.toFixed(2)}</StatusBadge>}
        </span>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-4">
          <Panel title="Claim" subtitle="buyer’s own words — untrusted text, never instructions">
            <div className="grid gap-3 sm:grid-cols-3 text-[14px]">
              <p>
                <span className="block text-[12px] text-[var(--muted)]">Requested</span>
                <strong>{fmtMoney(c.requestedMinor, cur)}</strong>
              </p>
              <p>
                <span className="block text-[12px] text-[var(--muted)]">Refundable now</span>
                <strong>{fmtMoney(c.refundableMinor, cur)}</strong>
              </p>
              <p>
                <span className="block text-[12px] text-[var(--muted)]">Approved</span>
                <strong>{c.approvedMinor === null ? '—' : fmtMoney(c.approvedMinor, cur)}</strong>
              </p>
            </div>
            {c.buyerText ? (
              <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-md border-l-4 border-[var(--line)] bg-[var(--surface-2)] p-3 text-[14px]">
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--muted)]">Buyer wrote (quoted)</span>
                {c.buyerText}
              </blockquote>
            ) : (
              <p className="mt-3 text-[13px] text-[var(--muted)]">No description.</p>
            )}
          </Panel>

          {c.lines.length > 0 && (
            <Panel title="Items being returned" subtitle={`${c.lines.reduce((s, l) => s + l.qty, 0)} unit${c.lines.reduce((s, l) => s + l.qty, 0) === 1 ? '' : 's'}`}>
              <ul className="divide-y divide-[var(--line)]">
                {c.lines.map((l) => (
                  <li key={l.productId} className="flex items-center gap-3 py-2 text-[14px]">
                    <ProductImage src={productImageUrl(l.productId, 'thumb')} category={l.category ?? ''} title={l.title} box={48} />
                    <span className="min-w-0 flex-1 break-words">{l.title}</span>
                    <span className="shrink-0 text-right tabular-nums">
                      {l.qty} × {fmtMoney(l.unitPriceMinor, cur)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Evidence" subtitle={`${c.evidence.length} item${c.evidence.length === 1 ? '' : 's'}`}>
            {c.evidence.length === 0 ? (
              <p className="text-[13px] text-[var(--muted)]">No evidence yet.</p>
            ) : (
              <ul className="space-y-3">
                {c.evidence.map((e) => (
                  <li key={e.evidenceId} className="flex flex-wrap gap-3 text-[13px]">
                    {e.hasImage ? (
                      <a href={`/admin/api/evidence/${e.evidenceId}/image`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- private evidence photo via the zone proxy */}
                        <img src={`/admin/api/evidence/${e.evidenceId}/image`} alt={`${e.kind.toLowerCase()} evidence`} width={140} height={140} loading="lazy" className="h-[140px] w-[140px] rounded-md border border-[var(--line)] object-cover" />
                      </a>
                    ) : (
                      <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-2)] text-[var(--muted)]">
                        {e.kind === 'TRACKING' ? '⛟' : '≡'}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{caseLabel(e.kind)} · <span className="font-normal text-[var(--muted)]">{when(e.at)}</span></p>
                      {e.findings && Object.keys(e.findings).length > 0 ? (
                        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                          {Object.entries(e.findings).slice(0, 8).map(([k, v]) => (
                            <div key={k} className="contents">
                              <dt className="text-[var(--muted)]">{k}</dt>
                              <dd className="break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-[var(--muted)]">No findings recorded.</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {c.agentProposal && (
            <Panel title={`Refund agent proposal — ${c.agentProposal.mode === 'SHADOW' ? 'shadow (not shown to support at L1)' : c.agentProposal.mode === 'RECOMMEND' ? 'recommendation' : 'live'}`} subtitle={`model ${c.agentProposal.rationale.model} · ${when(c.agentProposal.at)} · run ${c.agentProposal.runId}`}>
              <div className="space-y-2 text-[14px]">
                <p className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={c.agentProposal.outcome === 'REJECT' ? 'critical' : 'good'}>{OUTCOME[c.agentProposal.outcome] ?? c.agentProposal.outcome}</StatusBadge>
                  <strong>{fmtMoney(c.agentProposal.amountMinor, cur)}</strong>
                  <span className="text-[var(--muted)]">confidence {(c.agentProposal.confidence * 100).toFixed(0)}% · risk {c.agentProposal.riskScore.toFixed(2)}</span>
                </p>
                <p>{c.agentProposal.rationale.summary}</p>
                {c.agentProposal.rationale.ruleHits.length > 0 && <p className="text-[13px] text-[var(--muted)]">Rules: {c.agentProposal.rationale.ruleHits.join(', ')}</p>}
                {c.agentProposal.rationale.signals.length > 0 && <p className="text-[13px] text-[var(--muted)]">Signals: {c.agentProposal.rationale.signals.join(', ')}</p>}
                <p className="text-[12px] text-[var(--muted)]">The agent proposes; people (or the policy envelope at L3+) decide. Buyer-facing text: “{c.agentProposal.rationale.buyerExplanation}”</p>
              </div>
            </Panel>
          )}

          <Panel title="Decision history">
            {c.decisions.length === 0 ? (
              <p className="text-[13px] text-[var(--muted)]">No decisions yet.</p>
            ) : (
              <ol className="space-y-2 text-[13px]">
                {c.decisions.map((x, i) => (
                  <li key={i} className="flex flex-wrap gap-x-3">
                    <span className="text-[var(--muted)]">{when(x.at)}</span>
                    <code>{x.actor}</code>
                    <strong>{OUTCOME[x.outcome] ?? caseLabel(x.outcome)}</strong>
                    {x.amountMinor !== null && <span>{fmtMoney(x.amountMinor, cur)}</span>}
                    {x.note && <span className="text-[var(--muted)]">“{x.note}”</span>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Policy" subtitle={p ? `version ${p.policyVersion}` : 'not evaluated yet'}>
            {p ? (
              <div className="space-y-2 text-[13px]">
                <p className="flex flex-wrap gap-1">
                  {p.allowedOutcomes.map((o) => (
                    <StatusBadge key={o} tone={o === 'REJECT' ? 'critical' : 'neutral'}>
                      {OUTCOME[o] ?? o}
                    </StatusBadge>
                  ))}
                </p>
                <ul className="space-y-1">
                  <li>{p.hardReject ? '■ Hard reject by policy' : '✓ No hard reject'}</li>
                  <li>{p.autoEligible ? '✓ Inside the auto-approve envelope' : '○ Outside the auto-approve envelope'}</li>
                  <li>{p.requiresHuman ? '▲ Needs a person' : '○ No human review required by policy'}</li>
                  <li>Refundable: {fmtMoney(p.refundableMinor, cur)}</li>
                </ul>
                {p.ruleHits.length > 0 && (
                  <ul className="space-y-1 border-t border-[var(--line)] pt-2">
                    {p.ruleHits.map((h) => (
                      <li key={h.rule}>
                        <code>{h.rule}</code> <strong>{caseLabel(h.effect)}</strong> — <span className="text-[var(--muted)]">{h.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--muted)]">The policy hasn’t been evaluated for this case yet.</p>
            )}
          </Panel>

          {mayDecide ? (
            <Panel title={secondApproval ? 'Second approval (finance)' : 'Decide'} subtitle={secondApproval ? 'dual control: must be a different person from the first approver' : c.dualControl ? 'above the dual-control threshold: finance gives a second approval after you' : undefined}>
              {hardReject ? (
                <Notice tone="warning" title="Policy hard-rejects this case">Only rejection is possible; the buyer can appeal.</Notice>
              ) : (
                <ApproveForm action={approveCase} caseId={c.caseId} version={c.version} outcomes={outcomes} refundableMinor={c.refundableMinor} defaultMinor={c.approvedMinor ?? c.requestedMinor} proposal={c.agentProposal ? { outcome: c.agentProposal.outcome, amountMinor: c.agentProposal.amountMinor } : null} label={secondApproval ? 'Give second approval' : 'Approve'} />
              )}
              <form action={rejectCase} className="mt-4 space-y-2 border-t border-[var(--line)] pt-3">
                <input type="hidden" name="caseId" value={c.caseId} />
                <input type="hidden" name="version" value={c.version} />
                <Field label="Reject — note (required)" hint="The buyer sees an explanation based on this">
                  <Textarea name="note" rows={2} minLength={5} maxLength={500} required />
                </Field>
                <SubmitButton variant="danger">Reject</SubmitButton>
              </form>
            </Panel>
          ) : open ? (
            <Notice tone="info" title={`Waiting for ${needRole}`}>This case needs a decision from {needRole}.</Notice>
          ) : (
            <Notice tone="info" title="Decided">No further action needed.</Notice>
          )}
        </div>
      </div>
    </>,
    `Refund case ${c.orderNo}`,
  );
}
