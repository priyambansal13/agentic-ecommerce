import type { ReactNode } from 'react';

/**
 * Dashboard building blocks — server components (no client JS). Text always uses text tokens; colour is
 * reserved for marks and status, and status always comes with an icon + label (never colour alone).
 */

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

export function KpiTile({ label, value, hint, icon, href }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; href?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-bold text-[var(--muted)]">{label}</p>
        {icon && (
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--muted)] [&>svg]:h-4 [&>svg]:w-4">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-1 text-[24px] font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
    </>
  );
  const cls = 'block rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_1px_2px_rgba(15,17,17,0.06)]';
  return href ? (
    <a href={href} className={`${cls} hover:border-[var(--link)]`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Panel({ title, subtitle, children, className = '', action, icon }: { title: string; subtitle?: string; children: ReactNode; className?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_1px_2px_rgba(15,17,17,0.06)] ${className}`} aria-label={title}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {icon && (
            <span aria-hidden className="mt-0.5 text-[var(--muted)] [&>svg]:h-5 [&>svg]:w-5">
              {icon}
            </span>
          )}
          <div>
            <h2 className="text-[18px] font-bold leading-snug">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--muted)]">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="shrink-0 text-[13px]">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/** Friendly empty state: icon, one line, optional next step. */
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--line)] px-4 py-8 text-center">
      <span aria-hidden className="text-[var(--muted)] [&>svg]:h-10 [&>svg]:w-10">
        {icon ?? Glyph.inbox}
      </span>
      <p className="text-[15px] font-bold">{title}</p>
      {text && <p className="max-w-md text-[13px] text-[var(--muted)]">{text}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

const g = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
/** Small line icons for KPI tiles and panel headers (24×24, currentColor). */
export const Glyph = {
  inbox: g('M3 13l3-8h12l3 8v6H3z M3 13h5l1 3h6l1-3h5'),
  cart: g('M3 4h2l2.5 11h10L20 7H6.5 M9 20a1 1 0 1 0 0.01 0 M17 20a1 1 0 1 0 0.01 0'),
  box: g('M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10'),
  truck: g('M2 6h11v10H2z M13 10h4l3 3v3h-7 M6 19a2 2 0 1 0 0.01 0 M17 19a2 2 0 1 0 0.01 0'),
  money: g('M3 7h18v10H3z M12 9.5a2.5 2.5 0 1 0 0.01 0 M6 12h.01 M18 12h.01'),
  refund: g('M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3'),
  shield: g('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4'),
  alert: g('M12 4 2 20h20z M12 10v4 M12 17h.01'),
  clock: g('M12 3a9 9 0 1 0 0.01 0 M12 7v5l3 2'),
  check: g('M5 12l4 4 10-10'),
  users: g('M9 11a3 3 0 1 0 0.01 0 M3 20c0-3 3-5 6-5s6 2 6 5 M16 8a3 3 0 1 1 0 6 M18 15c2 .5 3 2 3 5'),
  tag: g('M3 12V3h9l9 9-9 9z M7.5 7.5h.01'),
  chart: g('M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6'),
  store: g('M4 9l1-5h14l1 5 M4 9h16v11H4z M4 9a3 3 0 0 0 5 0 3 3 0 0 0 6 0 3 3 0 0 0 5 0 M10 20v-5h4v5'),
  star: g('M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'),
  bot: g('M12 3v3 M5 8h14v11H5z M9 13h.01 M15 13h.01 M9 16h6 M2 12v3 M22 12v3'),
  gavel: g('M14 4l6 6 M11 7l6 6 M12.5 5.5l-6 6 4 4 6-6 M8.5 13.5 3 19l2 2 5.5-5.5'),
  doc: g('M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h7'),
  percent: g('M19 5 5 19 M7 7h.01 M17 17h.01 M7 4.5a2.5 2.5 0 1 0 0.01 0 M17 14.5a2.5 2.5 0 1 0 0.01 0'),
  heart: g('M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'),
};

/** Shown in place of a widget whose microservice did not answer — the rest of the page still works. */
export function Unavailable({ what, reason }: { what: string; reason: string }) {
  return (
    <div role="status" className="rounded-[var(--radius)] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
      <span aria-hidden>⚠︎ </span>
      {what} is unavailable right now ({reason}).
    </div>
  );
}

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral';
const ICON: Record<Tone, string> = { good: '●', warning: '▲', serious: '◆', critical: '■', neutral: '○' };

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const color = tone === 'neutral' ? 'var(--muted)' : `var(--status-${tone})`;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--line)] px-2 py-0.5 text-xs">
      <span aria-hidden style={{ color }}>
        {ICON[tone]}
      </span>
      {children}
    </span>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: R) => ReactNode;
}

export function DataTable<R>({ columns, rows, empty = 'Nothing here yet.', caption }: { columns: Column<R>[]; rows: R[]; empty?: string; caption?: string }) {
  if (!rows.length) return <p className="text-sm text-[var(--muted)]">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-[var(--line)] bg-[var(--surface-2)] text-left text-[12px] font-bold text-[var(--muted)]">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-2 py-2 ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--line)] last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={`px-2 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Vertical bar chart (time series / magnitude), one series → no legend (the panel title names it).
 * Thin bars with a 2px surface gap, rounded data-ends on the baseline, recessive grid, native tooltip per bar
 * (<title>, hit area = full column), and a table view for screen readers / exact values.
 */
export function BarChart({ data, format, ariaLabel, height = 160, labelEvery }: { data: BarDatum[]; format: (v: number) => string; ariaLabel: string; height?: number; labelEvery?: number }) {
  const W = 640;
  const H = height;
  const padL = 56;
  const padB = 22;
  const max = Math.max(1, ...data.map((d) => d.value));
  // counts: keep the half-way tick an integer (0 · 3 · 6, never 0 · 3 · 5)
  const nice = data.every((d) => Number.isInteger(d.value)) ? niceCountMax(max) : niceMax(max); // counts: integer mid tick
  const plotW = W - padL - 4;
  const plotH = H - padB - 6;
  const slot = plotW / Math.max(1, data.length);
  const bar = Math.min(28, Math.max(2, slot - 2)); // thin marks: never wider than 28px, 2px gap between bars
  const every = labelEvery ?? Math.ceil(data.length / 6);
  const ticks = [0, nice / 2, nice];
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => {
          const y = 6 + plotH - (t / nice) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={W} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {format(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / nice) * plotH;
          const x = padL + i * slot + (slot - bar) / 2;
          const y = 6 + plotH - h;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
              <rect x={padL + i * slot} y={6} width={slot} height={plotH} fill="transparent" />
              {h > 0 && <path d={roundedTop(x, y, bar, h, Math.min(4, bar / 2))} fill="var(--series-1)" />}
              {i % every === 0 && (
                <text x={x + bar / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <details className="mt-1 text-xs text-[var(--muted)]">
        <summary className="cursor-pointer">Table view</summary>
        <table className="mt-1">
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td className="pr-4">{d.label}</td>
                <td className="text-right tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Horizontal bars for categorical counts (rules, buckets, verdicts) — values direct-labeled, sorted by caller. */
export function HBarChart({ data, format = (v) => String(v), ariaLabel }: { data: BarDatum[]; format?: (v: number) => string; ariaLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-sm" title={`${d.label}: ${format(d.value)}`}>
          <span className="truncate text-[var(--muted)]">{d.label}</span>
          <span className="h-2.5 rounded-r bg-[var(--surface-2)]">
            <span className="block h-2.5 rounded-r" style={{ width: `${(d.value / max) * 100}%`, background: 'var(--series-1)' }} />
          </span>
          <span className="tabular-nums">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}
/** Nice maximum for whole-number data whose half is also a round integer: 2,4,6,8,10, 20,30,40,60,80,100 … */
function niceCountMax(v: number) {
  if (v <= 2) return 2;
  const m = 10 ** Math.floor(Math.log10(v));
  const steps = m === 1 ? [2, 4, 6, 8, 10] : [m, 2 * m, 3 * m, 4 * m, 6 * m, 8 * m, 10 * m];
  return steps.find((x) => x >= v) ?? 10 * m;
}
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Side navigation for multi-dashboard zones (admin): only the dashboards the user's roles allow. */
export function DashboardNav({ items, current }: { items: { href: string; label: string; icon?: ReactNode }[]; current: string }) {
  return (
    <nav aria-label="Dashboards" className="flex flex-wrap gap-1 self-start rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-2 md:sticky md:top-4 md:flex-col">
      {items.map((i) => (
        <a
          key={i.href}
          href={i.href}
          aria-current={current === i.href ? 'page' : undefined}
          className={`flex items-center gap-2 rounded px-3 py-1.5 text-[14px] ${current === i.href ? 'border-l-4 border-[var(--accent)] bg-[var(--surface-2)] font-bold' : 'text-[var(--link)] hover:bg-[var(--surface-2)] hover:text-[var(--link-hover)]'}`}
        >
          {i.icon && (
            <span aria-hidden className="text-[var(--muted)] [&>svg]:h-4 [&>svg]:w-4">
              {i.icon}
            </span>
          )}
          {i.label}
        </a>
      ))}
    </nav>
  );
}

export function Forbidden({ need, signedInAs }: { need: string; signedInAs?: string }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <span aria-hidden className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--muted)] [&>svg]:h-6 [&>svg]:w-6">
        {Glyph.shield}
      </span>
      <h1 className="text-xl font-semibold">Not available for your role</h1>
      <p className="mt-2 text-[var(--muted)]">
        This dashboard needs the <b>{need}</b> role{signedInAs ? ` — you are signed in as ${signedInAs}` : ''}.
      </p>
    </main>
  );
}
