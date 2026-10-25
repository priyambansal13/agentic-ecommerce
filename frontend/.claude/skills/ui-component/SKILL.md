---
name: ui-component
description: "Use when adding or changing a shared design-system component or design token in @ac/ui (frontend packages/ui) used by several micro-frontend zones — tokens, accessible components, server/client split, versioning impact on all zones. Trigger on \"shared component\", \"design system\", \"button/card/dialog for all zones\", \"theme\", \"tokens\"."
---

# Shared UI component (`@ac/ui`)

`@ac/ui` gives every zone the same look: `tokens.css` (CSS variables, light/dark), `SiteHeader`,
`ZoneLink` and shared primitives. A change here ships to **all zones**, so it must stay backwards compatible.

## 1. Belongs here?
Used by ≥ 2 zones, or part of the global chrome → `@ac/ui`. Zone-specific (product card, refund offer
card, approval card) → stays in the zone. Agent chat UI → `@ac/agent-widget`.

## 2. Build it
```tsx
// packages/ui/src/button.tsx
import type { ButtonHTMLAttributes } from 'react';
export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const base = 'inline-flex items-center rounded-md px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-50';
  const styles = variant === 'primary' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--line)]';
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}
```
- Colours/spacing only through tokens (`var(--…)`) defined in `packages/ui/tokens.css` (imported by zones as `@ac/ui/tokens.css`); both themes.
- Server-safe by default; add `'use client'` only when the component needs state/effects.
- Export from `packages/ui/src/index.ts`; keep props additive (new optional props, no renames).
- Tailwind v4 in zones must scan the package: zones' `globals.css` include `@source "../../../packages/ui/src";`.

## 3. Accessibility
Semantic elements, visible focus, labels for icon buttons, `aria-live` for async status, contrast ≥ 4.5:1
in both themes, keyboard operable dialogs (focus trap, Esc).

## 4. Verify across zones
```bash
pnpm turbo run build --filter=@ac/ui...     # builds the package and every zone that depends on it
```
Check the shell and at least one zone visually (`pnpm dev`, http://localhost:3300).

## Checklist
- [ ] Truly shared (≥ 2 zones / global chrome)
- [ ] Tokens only, light + dark
- [ ] Server component unless interactivity needed
- [ ] Additive API; exported from index
- [ ] a11y: keyboard, focus, labels, contrast
- [ ] All dependent zones build
