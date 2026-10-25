---
name: zone-page
description: "Use when building or changing a page/route inside a micro-frontend zone of the agentic-commerce frontend — React Server Component page fetching backend data through the zone BFF (`kongFetch`), caching and revalidation tags, Server Actions for mutations, loading/error/not-found states, and typed DTOs from @ac/contracts. Trigger on \"add page\", \"product page\", \"orders list\", \"call the X API from the UI\"."
---

# Page inside a zone

Read the API in `../platform/docs/02-lld.md` (service API tables) and the zone's purpose in the
micro-frontends doc. Pages are **server-first**: data is fetched on the server via the zone's BFF.

## 1. Server data access
```ts
// apps/storefront/src/lib/catalog.ts
import 'server-only';
import { kongFetch } from '@ac/bff';
import type { ProductDto } from '@ac/contracts';          // published package (versioned)

export async function getProduct(id: string) {
  const r = await kongFetch(`/api/catalog/v1/products/${id}`, {
    next: { revalidate: 600, tags: [`product:${id}`] },    // invalidated by the catalog "ProductUpdated" webhook
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`catalog ${r.status}`);
  return (await r.json()) as ProductDto;                   // validate with the contract schema if it's critical
}
```
`kongFetch` adds the Kong base URL, request id and (P1) the user's access token from the session.
Never call backend services from client components.

## 2. Page
```tsx
// apps/storefront/src/app/p/[id]/page.tsx   → /shop/p/<id>
import { notFound } from 'next/navigation';
import { format, money } from '@ac/money';
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProduct(id);
  if (!p) notFound();
  return (<article><h1>{p.title}</h1><p>{format(money(p.priceMinor, p.currency))}</p></article>);
}
```
Add `loading.tsx`, `error.tsx` (client, no stack traces), `not-found.tsx` for the route segment.
Dynamic islands (price/stock) can stream separately with `<Suspense>`.

## 3. Mutations
Server Actions inside the zone call the backend through `kongFetch` with an `Idempotency-Key` for money/
stock operations (cart add is idempotent per sku; checkout must send a key per attempt). After success,
`revalidateTag(...)` / `revalidatePath(...)` for this zone only.

## 4. Cross-zone
Linking to another zone → `<ZoneLink>`; never fetch another zone's routes. If two zones need the same
data, both call the backend API (or a shared package helper), not each other.

## 5. Tests
Component tests for presentational parts; Playwright through the shell (`http://localhost:3300/shop/...`)
covering happy path + error state; `pnpm build --filter @ac/zone-<name>` must pass (type-checks RSC/client split).

## Checklist
- [ ] Data fetched server-side via `kongFetch`; DTO types from `@ac/contracts`
- [ ] Cache tags/revalidate set deliberately; mutations revalidate
- [ ] loading / error / not-found states
- [ ] Money formatted from minor units via `@ac/money`; never floats
- [ ] Idempotency-Key on money/stock mutations
- [ ] No client-side secrets; cross-zone links via ZoneLink
