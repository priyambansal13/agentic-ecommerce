/**
 * Demo catalogue photos: curated free-licence stock photos (CC0 / public domain / CC BY — never SA/ND/NC) from
 * Wikimedia Commons and Flickr via Openverse, keyed by base product type (CATALOG item) and category id.
 * The catalog seed downloads, re-encodes and stores them in the catalog bucket; every page that shows one credits it.
 */
import { createHash } from 'node:crypto';
import manifest from './images.json' with { type: 'json' };
import type { DemoWorld } from './index.js';

export interface StockPhoto {
  url: string;
  /** ≤ 1280 px rendition to download (the original can be 8k) */
  downloadUrl: string;
  title: string;
  creator: string;
  license: string;
  licenseUrl: string | null;
  sourceUrl: string;
  width: number;
  height: number;
  provider: string;
}
export const STOCK_PHOTOS = manifest as unknown as { products: Record<string, StockPhoto[]>; categories: Record<string, StockPhoto> };

/** stable short key per photo → object prefix stock/<key> (shared by every product that uses it) */
export const photoKey = (p: StockPhoto) => createHash('sha256').update(p.downloadUrl).digest('hex').slice(0, 20);
const uuidOf = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export interface DemoProductImage { imageId: string; productId: string; position: number; photo: StockPhoto; alt: string }

/**
 * 1–3 photos per product of its base type, rotated by variant so products of the same type start with a
 * different primary photo where the type has several. Deterministic (ids derive from product + photo).
 */
export function demoProductImages(w: DemoWorld): DemoProductImage[] {
  const seen = new Map<string, number>();
  const out: DemoProductImage[] = [];
  for (const p of w.products) {
    const photos = STOCK_PHOTOS.products[p.item] ?? [];
    if (!photos.length) continue;
    const v = seen.get(p.item) ?? 0;
    seen.set(p.item, v + 1);
    const count = Math.min(photos.length, 3);
    for (let i = 0; i < count; i++) {
      const photo = photos[(v + i) % photos.length];
      out.push({ imageId: uuidOf(`${p.id}:${photoKey(photo)}`), productId: p.id, position: i, photo, alt: p.title });
    }
  }
  return out;
}

export const categoryImageId = (categoryId: string) => uuidOf(`category:${categoryId}`);
