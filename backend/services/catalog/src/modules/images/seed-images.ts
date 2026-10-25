/**
 * Demo catalogue photos → this service's bucket. Downloads each curated photo once (cached on disk, polite and
 * sequential), re-encodes it to WebP sizes under stock/<photoKey>/, then writes product_images / category_images.
 * Idempotent: photos already in the bucket are not downloaded again. Offline → products keep the placeholder.
 */
import { categoryImageId, type DemoWorld, demoProductImages, photoKey, STOCK_PHOTOS, type StockPhoto } from '@ac/demo-data';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { processImage } from './image-processing.js';
import type { ObjectStore } from './object-store.js';

type Query = (sql: string, params?: unknown[]) => Promise<unknown>;
const UA = 'agentic-commerce-demo/0.1 (local demo)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const attribution = (p: StockPhoto) => ({ creator: p.creator, license: p.license, licenseUrl: p.licenseUrl, sourceUrl: p.sourceUrl, title: p.title });

function cacheDir() {
  if (process.env.DEMO_IMAGE_CACHE) return process.env.DEMO_IMAGE_CACHE;
  // backend repo root (has pnpm-workspace.yaml) when run from a checkout, else the working directory (container)
  for (let d = process.cwd(); d !== dirname(d); d = dirname(d)) if (existsSync(join(d, 'pnpm-workspace.yaml'))) return join(d, '.cache', 'demo-images');
  return join(process.cwd(), '.cache', 'demo-images');
}

async function download(p: StockPhoto, dir: string): Promise<Buffer | null> {
  const file = join(dir, `${photoKey(p)}.img`);
  if (existsSync(file)) return readFileSync(file);
  for (const url of [p.downloadUrl, p.url]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90_000) }).catch(() => null);
      if (r?.status === 429) {
        await sleep(15_000 * (attempt + 1));
        continue;
      }
      if (!r?.ok) break;
      // the timeout also covers reading the body — a slow transfer is a retry, not a crash
      const buf = await r.arrayBuffer().then((b) => Buffer.from(b), () => null);
      if (!buf) continue;
      writeFileSync(file, buf);
      await sleep(800);
      return buf;
    }
  }
  return null;
}

/** returns the photo keys that are available in the bucket */
async function ensurePhotos(store: ObjectStore, photos: StockPhoto[]) {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const ready = new Set<string>();
  let fetched = 0;
  for (const p of photos) {
    const key = photoKey(p);
    if (ready.has(key)) continue;
    if (await store.exists(`stock/${key}/full.webp`)) {
      ready.add(key);
      continue;
    }
    const buf = await download(p, dir);
    if (!buf) {
      console.warn(`  ! photo not available (offline?): ${p.title} — ${p.downloadUrl}`);
      continue;
    }
    try {
      const img = await processImage(buf, { minSide: 0, maxBytes: 60 * 1024 * 1024 });
      for (const [size, b] of Object.entries(img.variants)) await store.put(`stock/${key}/${size}.webp`, b);
      ready.add(key);
      fetched++;
    } catch (e) {
      console.warn(`  ! photo could not be processed: ${p.title}: ${(e as Error).message}`);
    }
  }
  return { ready, fetched };
}

export async function seedImages(q: Query, store: ObjectStore, w: DemoWorld) {
  if (!store.configured) {
    console.warn('catalog seed: S3_* not configured — skipping product images (run: ac configure && ac infra init)');
    return { productImages: 0, categoryImages: 0, photos: 0 };
  }
  const assignments = demoProductImages(w);
  const all = [...new Map([...assignments.map((a) => a.photo), ...Object.values(STOCK_PHOTOS.categories)].map((p) => [photoKey(p), p])).values()];
  const { ready, fetched } = await ensurePhotos(store, all);

  // products/categories were truncated (CASCADE) above, so these tables start empty
  const rows = assignments.filter((a) => ready.has(photoKey(a.photo)));
  // positions stay contiguous when a photo is missing
  const pos = new Map<string, number>();
  const values = rows.map((a) => {
    const p = pos.get(a.productId) ?? 0;
    pos.set(a.productId, p + 1);
    return [a.imageId, a.productId, p, `stock/${photoKey(a.photo)}`, a.photo.width, a.photo.height, a.alt, 'stock', JSON.stringify(attribution(a.photo))];
  });
  for (let i = 0; i < values.length; i += 300) {
    const chunk = values.slice(i, i + 300);
    const params: unknown[] = [];
    const sql = chunk.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(', ')})`).join(', ');
    await q(`INSERT INTO product_images (id, product_id, position, object_prefix, width, height, alt, source, attribution) VALUES ${sql}`, params);
  }
  let categories = 0;
  await q(`DELETE FROM category_images`);
  for (const [id, p] of Object.entries(STOCK_PHOTOS.categories)) {
    if (!ready.has(photoKey(p))) continue;
    await q(
      `INSERT INTO category_images (category_id, image_id, object_prefix, width, height, attribution)
       SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM categories WHERE id = $1)`,
      [id, categoryImageId(id), `stock/${photoKey(p)}`, p.width, p.height, JSON.stringify(attribution(p))],
    );
    categories++;
  }

  // bucket hygiene: seller uploads of the previous demo world and photos no longer in the manifest
  const keep = new Set(all.map(photoKey));
  const orphans = [
    ...(await store.list('products/')),
    ...(await store.list('stock/')).filter((k) => !keep.has(k.split('/')[1])),
  ];
  await store.deleteKeys(orphans);
  console.log(`catalog seed: ${values.length} product images (${ready.size}/${all.length} photos, ${fetched} downloaded), ${categories} category banners, ${orphans.length} orphaned objects removed`);
  return { productImages: values.length, categoryImages: categories, photos: ready.size };
}
