import { load } from '@ac/bff';
import { AgentRegistrySchema, AgentRunsSchema, AgentsDashboardSchema, EvalReportSchema, ShadowReportSchema } from '@ac/contracts';
import { DataTable, EmptyState, fmtAge, fmtInt, fmtPct, Glyph, HBarChart, KpiGrid, KpiTile, Notice, Panel, StatusBadge, Unavailable } from '@ac/ui';
import Link from 'next/link';
import { requireStaff, StaffFrame } from '../../lib/guard';
import { LEVELS, OUTCOME, REASON } from '../../lib/refunds';
import { setAutonomy } from './actions';
import { AutonomyControl } from './autonomy-control';

export const dynamic = 'force-dynamic';
const ago = (iso: string) => `${fmtAge((Date.now() - Date.parse(iso)) / 3_600_000)} ago`;
const levelName = (l: number) => `L${l} · ${LEVELS[l]?.name ?? '?'}`;

/**
 * Agent oversight (admin): registry + autonomy control, L1 shadow agreement, offline eval gate, recent runs, and the
 * governed tool-call trail with audit-chain integrity. Real data only — every widget degrades on its own.
 */
export default async function AgentsDashboard({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const g = await requireStaff('/admin/agents');
  if ('denied' in g) return g.denied;
  const sp = await searchParams;
  const [reg, shadow, evals, runs, d] = await Promise.all([
    load(AgentRegistrySchema, '/api/agents/v1/agents/registry'),
    load(ShadowReportSchema, '/api/returns/v1/refund-cases/shadow-report?days=30'),
    load(EvalReportSchema, '/api/agents/v1/agents/refund/evals/latest'),
    load(AgentRunsSchema, '/api/agents/v1/agents/runs?limit=20'),
    load(AgentsDashboardSchema, '/api/agents/v1/dashboard'),
  ]);

  return (
    <StaffFrame session={g.session} current="/admin/agents" title="Agent oversight" intro="Agents propose, services dispose. Every tool call goes zod → kill switch → OPA → audit; autonomy changes are audited too.">
      {sp.ok && <Notice tone="success">{sp.ok}</Notice>}
      {sp.err && <Notice tone="error">{sp.err}</Notice>}

      <Panel title="Agents & autonomy" icon={Glyph.bot} subtitle="L0 off · L1 shadow · L2 recommend · L3 bounded auto · L4 auto + audit">
        {reg.ok ? (
          reg.data.items.length === 0 ? (
            <EmptyState icon={Glyph.bot} title="No agents registered" />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {reg.data.items.map((a) => (
                <article key={a.id} className="space-y-3 rounded-[var(--radius)] border border-[var(--line)] p-4">
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-[16px] font-bold">
                        <code>{a.id}</code> <span className="text-[12px] font-normal text-[var(--muted)]">v{a.version}</span>
                      </h3>
                      <p className="text-[13px] text-[var(--muted)]">{a.description}</p>
                    </div>
                    <StatusBadge tone={a.autonomy === 0 ? 'critical' : a.autonomy >= 3 ? 'warning' : 'neutral'}>{levelName(a.autonomy)}</StatusBadge>
                  </header>
                  <p className="text-[13px]">{LEVELS[a.autonomy]?.text}</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
                    <div>
                      <dt className="text-[var(--muted)]">Max level</dt>
                      <dd>{levelName(a.maxAutonomy)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Model</dt>
                      <dd>{a.model.provider === 'offline' ? 'offline' : `${a.model.fast} / ${a.model.smart}`}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Runs today</dt>
                      <dd className="tabular-nums">
                        {fmtInt(a.budgets.runsToday)} / {fmtInt(a.budgets.dailyRuns)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Per run</dt>
                      <dd className="tabular-nums">
                        ≤ {a.budgets.maxSteps} steps · {fmtInt(a.budgets.maxTokens)} tokens
                      </dd>
                    </div>
                  </dl>
                  {a.model.provider === 'offline' && (
                    <p className="flex items-start gap-2 rounded-md bg-[var(--surface-2)] p-2 text-[12px]">
                      <span aria-hidden>▲</span>
                      <span>Offline model — deterministic stand-in for dev and CI. Set OPENAI_API_KEY (ac configure) to use OpenAI, then re-run the evals before raising autonomy.</span>
                    </p>
                  )}
                  <p className="text-[12px] text-[var(--muted)]">{a.lastChange ? `Last change ${ago(a.lastChange.at)} by ${a.lastChange.by}: “${a.lastChange.reason}”` : 'No autonomy changes yet.'}</p>
                  <AutonomyControl action={setAutonomy} agentId={a.id} level={a.autonomy} maxLevel={a.maxAutonomy} />
                </article>
              ))}
            </div>
          )
        ) : (
          <Unavailable what="Agent registry" reason={reg.error} />
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Refund agent — shadow agreement" icon={Glyph.check} subtitle="last 30 days · agent proposal vs the final human decision">
          {shadow.ok ? (
            shadow.data.withProposal === 0 ? (
              <EmptyState icon={Glyph.clock} title="No shadow proposals yet" text="At L1 the agent runs on every new return and stores its proposal; agreement appears once people have decided some of those cases." />
            ) : (
              <div className="space-y-3">
                <KpiGrid>
                  <KpiTile label="Outcome agreement" value={fmtPct(shadow.data.outcomeAgreement)} hint={`${fmtInt(shadow.data.withProposal)} of ${fmtInt(shadow.data.decidedCases)} decided cases had a proposal`} />
                  <KpiTile label="Amount agreement" value={fmtPct(shadow.data.amountAgreement)} hint="same outcome and amount" />
                </KpiGrid>
                <HBarChart ariaLabel="Outcome agreement by return reason (percent)" data={shadow.data.byReason.filter((r) => r.cases > 0).map((r) => ({ label: `${REASON[r.reasonCode] ?? r.reasonCode} (${r.cases})`, value: Math.round(r.agreement * 100) }))} format={(v) => `${v}%`} />
                <details>
                  <summary className="cursor-pointer text-[13px] text-[var(--link)]">Table view</summary>
                  <DataTable
                    caption="Shadow agreement by reason"
                    rows={shadow.data.byReason}
                    columns={[
                      { key: 'r', label: 'Reason', render: (r) => REASON[r.reasonCode] ?? r.reasonCode },
                      { key: 'n', label: 'Cases', align: 'right', render: (r) => fmtInt(r.cases) },
                      { key: 'a', label: 'Agreement', align: 'right', render: (r) => (r.cases ? fmtPct(r.agreement) : '—') },
                    ]}
                  />
                </details>
                {shadow.data.disagreements.length > 0 && (
                  <DataTable
                    caption="Disagreements"
                    rows={shadow.data.disagreements.slice(0, 10)}
                    columns={[
                      { key: 'o', label: 'Case', render: (x) => <a className="text-[var(--link)] hover:underline" href={`/admin/support/${x.caseId}`}>{x.orderNo}</a> },
                      { key: 'a', label: 'Agent', render: (x) => OUTCOME[x.agentOutcome] ?? x.agentOutcome },
                      { key: 'h', label: 'Human', render: (x) => OUTCOME[x.humanOutcome] ?? x.humanOutcome.toLowerCase().replaceAll('_', ' ') },
                    ]}
                  />
                )}
              </div>
            )
          ) : (
            <Unavailable what="Shadow report" reason={shadow.error} />
          )}
        </Panel>

        <Panel title="Refund agent — offline evals" icon={Glyph.shield} subtitle="release gate: dataset accuracy + red team">
          {evals.ok ? (
            <div className="space-y-3 text-[13px]">
              <p className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={evals.data.gate.passed ? 'good' : 'critical'}>{evals.data.gate.passed ? 'gate passed' : 'gate FAILED'}</StatusBadge>
                <span className="text-[var(--muted)]">
                  run {ago(evals.data.runAt)} · {evals.data.modelProvider === 'offline' ? 'offline model' : evals.data.model} · {fmtInt(evals.data.datasetSize)} cases
                </span>
              </p>
              {evals.data.gate.reasons.length > 0 && <ul className="list-disc pl-5">{evals.data.gate.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              <KpiGrid>
                <KpiTile label="Outcome accuracy" value={fmtPct(evals.data.outcomeAccuracy)} />
                <KpiTile label="Amount accuracy" value={fmtPct(evals.data.amountAccuracy)} />
                <KpiTile
                  label="Unauthorised MONEY calls"
                  value={<StatusBadge tone={evals.data.redTeam.unauthorizedMoneyCalls === 0 ? 'good' : 'critical'}>{fmtInt(evals.data.redTeam.unauthorizedMoneyCalls)}</StatusBadge>}
                  hint={`${fmtInt(evals.data.redTeam.cases)} red-team cases · ${fmtInt(evals.data.redTeam.injectionFlagged)} injections flagged`}
                />
              </KpiGrid>
              <DataTable
                caption="Accuracy by reason"
                rows={evals.data.byReason}
                columns={[
                  { key: 'r', label: 'Reason', render: (r) => REASON[r.reasonCode] ?? r.reasonCode },
                  { key: 'n', label: 'Cases', align: 'right', render: (r) => fmtInt(r.cases) },
                  { key: 'a', label: 'Accuracy', align: 'right', render: (r) => fmtPct(r.accuracy) },
                ]}
              />
            </div>
          ) : evals.status === 404 ? (
            <EmptyState icon={Glyph.doc} title="No eval run yet" text="Run the refund agent evals (pnpm --filter @ac/agents run evals -- --agent refund) to see the release gate here." />
          ) : (
            <Unavailable what="Eval report" reason={evals.error} />
          )}
        </Panel>
      </div>

      <Panel title="Recent agent runs" icon={Glyph.clock}>
        {runs.ok ? (
          <DataTable
            caption="Recent agent runs"
            empty="No agent runs yet."
            rows={runs.data.items}
            columns={[
              { key: 'at', label: 'Started', render: (r) => ago(r.startedAt) },
              { key: 'ag', label: 'Agent', render: (r) => <code>{r.agentId}</code> },
              { key: 's', label: 'Subject', render: (r) => <span className="text-xs">{r.subject}</span> },
              { key: 'm', label: 'Mode', render: (r) => <StatusBadge tone={r.mode === 'LIVE' ? 'warning' : 'neutral'}>{r.mode.toLowerCase()}</StatusBadge> },
              { key: 'st', label: 'Status', render: (r) => <StatusBadge tone={r.status === 'COMPLETED' ? 'good' : r.status === 'FAILED' || r.status === 'BLOCKED' ? 'critical' : 'warning'}>{r.status.toLowerCase()}</StatusBadge> },
              { key: 'steps', label: 'Steps', align: 'right', render: (r) => fmtInt(r.steps) },
              { key: 'tc', label: 'Tool calls', align: 'right', render: (r) => `${fmtInt(r.toolCalls)}${r.deniedCalls ? ` (${r.deniedCalls} denied)` : ''}` },
              { key: 'o', label: 'Outcome', render: (r) => (r.outcome ? OUTCOME[r.outcome] ?? r.outcome : '—') },
              { key: 'd', label: 'Duration', align: 'right', render: (r) => (r.durationMs === null ? '—' : `${(r.durationMs / 1000).toFixed(1)} s`) },
            ]}
          />
        ) : (
          <Unavailable what="Agent runs" reason={runs.error} />
        )}
      </Panel>

      {d.ok ? (
        <>
          <KpiGrid>
            <KpiTile icon={Glyph.bot} label="Tool calls (24 h)" value={fmtInt(d.data.toolCalls24h.total)} />
            <KpiTile icon={Glyph.check} label="Allowed by OPA" value={fmtInt(d.data.toolCalls24h.allowed)} />
            <KpiTile icon={Glyph.shield} label="Denied" value={fmtInt(d.data.toolCalls24h.denied)} />
            <KpiTile icon={Glyph.shield} label="Audit chain" value={<StatusBadge tone={d.data.chainIntact ? 'good' : 'critical'}>{d.data.chainIntact ? 'intact' : 'BROKEN'}</StatusBadge>} hint="hash-chained, tamper-evident" />
          </KpiGrid>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Recent tool calls" className="lg:col-span-2">
              <DataTable
                caption="Recent tool calls"
                empty="No agent activity yet."
                rows={d.data.recent}
                columns={[
                  { key: 'at', label: 'When', render: (r) => ago(r.at) },
                  { key: 'agent', label: 'Agent', render: (r) => r.agent },
                  { key: 'tool', label: 'Tool', render: (r) => <code>{r.tool}</code> },
                  { key: 'tier', label: 'Tier', render: (r) => r.tier },
                  { key: 'opa', label: 'OPA', render: (r) => <StatusBadge tone={r.allowed ? 'good' : 'critical'}>{r.allowed ? 'allowed' : 'denied'}</StatusBadge> },
                  { key: 'why', label: 'Reasons', render: (r) => <span className="text-xs text-[var(--muted)]">{r.reasons.join(', ') || '—'}</span> },
                ]}
              />
            </Panel>
            <Panel title="Calls by tool" subtitle="24 h">
              <HBarChart ariaLabel="Tool calls by tool" data={d.data.byTool.map((b) => ({ label: b.tool, value: b.count }))} />
              <p className="mt-3 text-sm">
                <Link href="/agents/ping" className="underline">
                  Run the platform check agent
                </Link>
              </p>
            </Panel>
          </div>
        </>
      ) : (
        <Unavailable what="Tool-call audit trail" reason={d.error} />
      )}
    </StaffFrame>
  );
}
