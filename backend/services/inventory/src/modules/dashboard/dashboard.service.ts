import { Injectable } from '@nestjs/common';
import { SellerStockDashboardSchema } from '@ac/contracts';
import { DataSource } from 'typeorm';

const n = (v: unknown) => Number(v ?? 0);

@Injectable()
export class DashboardService {
  constructor(private readonly db: DataSource) {}

  async seller(sellerId: string) {
    const [k] = await this.db.query(
      `SELECT count(*) AS total, count(*) FILTER (WHERE on_hand - reserved <= 0) AS out FROM stock WHERE seller_id = $1`,
      [sellerId],
    );
    const low = await this.db.query(
      `SELECT sku, product_id, title, on_hand - reserved AS available, low_stock_threshold AS threshold
         FROM stock WHERE seller_id = $1 AND on_hand - reserved <= low_stock_threshold
        ORDER BY on_hand - reserved ASC, sku LIMIT 10`,
      [sellerId],
    );
    return SellerStockDashboardSchema.parse({
      totalSkus: n(k.total),
      outOfStock: n(k.out),
      lowStock: low.map((r: any) => ({ sku: r.sku, productId: r.product_id ?? undefined, title: r.title, available: n(r.available), threshold: n(r.threshold) })),
    });
  }
}
