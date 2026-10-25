import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CategoriesSchema } from '@ac/contracts';
import type { z } from 'zod';

type Category = z.infer<typeof CategoriesSchema>['categories'][number];
const TTL_MS = 5 * 60_000;

/** Category list (which ones are gated) owned by the catalog service — GET /api/catalog/v1/categories via Kong, cached 5 min. */
@Injectable()
export class CatalogCategories {
  private readonly log = new Logger(CatalogCategories.name);
  private cache?: { at: number; items: Category[] };

  async list(): Promise<Category[]> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.items;
    try {
      const res = await fetch(`${process.env.KONG_URL ?? 'http://localhost:58000'}/api/catalog/v1/categories`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = CategoriesSchema.parse(await res.json()).categories;
      this.cache = { at: Date.now(), items };
      return items;
    } catch (e) {
      this.log.warn(`catalog categories unavailable: ${(e as Error).message}`);
      if (this.cache) return this.cache.items; // stale is better than nothing for a static list
      throw new ServiceUnavailableException('Category list is temporarily unavailable — try again shortly');
    }
  }
}
