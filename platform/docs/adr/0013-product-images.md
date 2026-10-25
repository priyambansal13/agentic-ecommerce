# ADR 0013 — Product images in a per-service MinIO bucket; free-licence demo photos

- **Status:** Accepted (2026-10-23)
- **Related:** [10-marketplace.md §10.12](../10-marketplace.md#1012-product-images), [ADR 0012](0012-marketplace-model.md), [07](../07-microservices.md)

## Context

The UI needs real product photos (storefront, product page, orders, Seller Central, moderation), the demo catalogue
had none, and sellers must be able to upload their own. The product owner chose free-licence stock photos for the
demo catalogue and seller uploads stored in MinIO. Constraints: isolation per service (ADR 0011 / rule 1), one
12 GB node, no AWS, no paid APIs.

## Decision

1. **The catalog service owns images.** Rows in `ac_catalog` (`product_images`, `category_images`); bytes in its own
   bucket `ac-catalog`. Isolation is enforced like databases: service metadata `"objectStore": true` → `ac configure` /
   `ac k8s secrets` generate a MinIO user `svc-catalog` with a policy for that bucket only, created idempotently by
   `ac infra init` (local) and the `db-bootstrap` hook Job (k8s). No other service has credentials for it.
2. **Process on upload, serve immutable variants.** Validate by magic bytes, ≥ 500 px, ≤ 5 MB, ≤ 5 per product;
   re-encode with sharp to WebP at 160 / 400 / 1000 px and strip metadata. Bytes are served publicly through Kong
   (`/api/catalog/v1/images/:imageId/:size`, `immutable` caching; a new upload gets a new id). Uploads go through the
   seller zone's server code → Kong → catalog (no presigned browser uploads: MinIO stays inside the cluster).
3. **Demo photos: Openverse / Wikimedia Commons, CC0 / public domain / CC BY only.** 92 product photos (34 types) and
   8 category banners, curated by hand from contact sheets, recorded with creator, licence and source in
   `@ac/demo-data` `images.json`, and credited wherever shown (`ProductImage.attribution`). Pexels/Unsplash were the
   first idea but need API keys; Openverse and the Commons API work without one (both are rate limited — the seed
   downloads each photo once, caches it on disk and stores it once under `stock/<key>/`, shared by all products of a type).

## Consequences

- Product pages, cards and dashboards can show real images from one URL scheme; other services only need a
  `productId` (`productImageUrl()`), never storage access.
- CC BY obliges attribution — UIs must render the credit; SA/ND/NC photos are excluded so resizing/re-encoding is allowed.
- Images are live as soon as the owner uploads them; image moderation is future work (moderation agent).
- One more stateful dependency for catalog (MinIO): image GETs fail (404/5xx) when it is down and the UI falls back to
  the category placeholder; listings keep working.
- Seeding needs internet once (Wikimedia/Flickr); offline seeds skip photos with a warning.
