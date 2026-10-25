'use client';
import { Input, Select, SubmitButton } from '@ac/ui';
import { useState } from 'react';

const NAMES = ['Off', 'Shadow', 'Recommend', 'Bounded auto', 'Auto + audit'];

/**
 * Autonomy control for one agent (admin only). Raising to L3+ lets the agent execute money actions inside the
 * policy envelope, so it asks for confirmation. The kill switch sets L0 immediately (also confirmed).
 */
export function AutonomyControl({ action, agentId, level, maxLevel }: { action: (fd: FormData) => Promise<void>; agentId: string; level: number; maxLevel: number }) {
  const [next, setNext] = useState(level);
  return (
    <div className="space-y-2">
      <form
        action={action}
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          if (next >= 3 && level < 3 && !window.confirm(`Raise ${agentId} to L${next} (${NAMES[next]})?\n\nAt L3+ the agent can EXECUTE refunds itself inside the policy envelope (amount, risk and OPA limits). Everything outside the envelope still goes to a person.`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="agentId" value={agentId} />
        <label className="text-[13px]">
          Level
          <Select name="level" value={String(next)} onChange={(e) => setNext(Number(e.target.value))} aria-label={`Autonomy level for ${agentId}`}>
            {NAMES.slice(0, maxLevel + 1).map((n, i) => (
              <option key={n} value={i}>
                L{i} · {n}
              </option>
            ))}
          </Select>
        </label>
        <label className="min-w-[12rem] flex-1 text-[13px]">
          Reason (audited)
          <Input name="reason" required minLength={5} maxLength={300} placeholder="e.g. shadow agreement ≥ 90 % for 2 weeks" />
        </label>
        <SubmitButton variant="outline" disabled={next === level}>
          Apply
        </SubmitButton>
      </form>
      {level > 0 && (
        <form action={action} onSubmit={(e) => { if (!window.confirm(`Turn ${agentId} OFF now (kill switch)? It stops before its next tool call.`)) e.preventDefault(); }}>
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="level" value="0" />
          <input type="hidden" name="reason" value="Kill switch pressed in the agent oversight console" />
          <SubmitButton variant="danger">Kill switch (L0)</SubmitButton>
        </form>
      )}
    </div>
  );
}
