'use client';
import { Field, Input, Select, SubmitButton, Textarea } from '@ac/ui';
import { useState } from 'react';

const LABEL: Record<string, string> = { REFUND: 'Full refund', PARTIAL_REFUND: 'Partial refund', REPLACEMENT: 'Replacement', STORE_CREDIT: 'Store credit' };
const rupees = (minor: number) => (minor / 100).toFixed(2);

/**
 * Approve form. Outcomes are limited to what the policy allows; the amount is capped at the refundable amount.
 * "Use agent proposal" pre-fills outcome + amount (the reviewer still decides and submits).
 */
export function ApproveForm({ action, caseId, version, outcomes, refundableMinor, defaultMinor, proposal, label }: {
  action: (fd: FormData) => Promise<void>;
  caseId: string;
  version: number;
  outcomes: string[];
  refundableMinor: number;
  defaultMinor: number;
  proposal: { outcome: string; amountMinor: number } | null;
  label: string;
}) {
  const usable = proposal && outcomes.includes(proposal.outcome) ? proposal : null;
  const [outcome, setOutcome] = useState(outcomes[0] ?? 'REFUND');
  const [amount, setAmount] = useState(rupees(Math.min(defaultMinor, refundableMinor)));
  const over = Math.round(Number(amount) * 100) > refundableMinor;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="version" value={version} />
      {usable && (
        <button type="button" onClick={() => { setOutcome(usable.outcome); setAmount(rupees(Math.min(usable.amountMinor, refundableMinor))); }} className="rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-[13px] hover:bg-[var(--surface-2)]">
          Use agent proposal ({LABEL[usable.outcome] ?? usable.outcome}, ₹{rupees(usable.amountMinor)})
        </button>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Outcome" hint="Only outcomes the policy allows">
          <Select name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {outcomes.map((o) => (
              <option key={o} value={o}>
                {LABEL[o] ?? o}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (₹)" hint={`At most ₹${rupees(refundableMinor)} (refundable)`} error={over ? 'More than the refundable amount' : undefined}>
          <Input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
      </div>
      <Field label="Note (optional)" hint="Kept in the decision history">
        <Textarea name="note" rows={2} maxLength={500} />
      </Field>
      <SubmitButton disabled={over || !outcomes.length}>{label}</SubmitButton>
    </form>
  );
}
