import { Injectable } from '@nestjs/common';
import { CatalogDashboardSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';

const n = (v: unknown) => Number(v ?? 0);

@Injectable()
export class DashboardService {
  constructor(private readonly db: DataSource) {}

  async summary() {
    const [k] = await this.db.query(
      `SELECT count(*) FILTER (WHERE status = 'PUBLISHED') AS published,
              count(*) FILTER (WHERE status = 'DRAFT') AS draft,
              count(*) FILTER (WHERE status = 'PENDING_REVIEW') AS pending,
              count(*) FILTER (WHERE status = 'REJECTED') AS rejected,
              count(DISTINCT seller_id) FILTER (WHERE status = 'PUBLISHED') AS sellers
         FROM products`,
    );
    return CatalogDashboardSchema.parse({ published: n(k.published), draft: n(k.draft), pendingReview: n(k.pending), rejected: n(k.rejected), sellers: n(k.sellers) });
  }
}
