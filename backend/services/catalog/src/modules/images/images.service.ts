import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { type ImageSize, imageUrl, ProductImageSchema } from '@ac/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { canManageImages, ImageError, MAX_IMAGES_PER_PRODUCT, type ProcessedImage, processImage } from './image-processing.js';
import { ObjectStore } from './object-store.js';

const STATUS: Record<string, number> = { NOT_OWNER: 403, TOO_LARGE: 413, TOO_MANY_IMAGES: 422, UNSUPPORTED_TYPE: 422, TOO_SMALL: 422 };
/** ImageError → HTTP with an ImageRejection body ({ code, message }) */
export const rejection = (e: ImageError) => new HttpException({ code: e.code, message: e.message }, STATUS[e.code] ?? 422);

export const productPrefix = (productId: string, imageId: string) => `products/${productId}/${imageId}`;
export const categoryPrefix = (categoryId: string, imageId: string) => `categories/${categoryId}/${imageId}`;

interface ImageRow { id: string; position: number; alt: string; width: number; height: number; attribution: unknown }
export const toProductImage = (r: ImageRow) =>
  ProductImageSchema.parse({ imageId: r.id, position: r.position, alt: r.alt, width: r.width, height: r.height, attribution: r.attribution ?? null });

@Injectable()
export class ImagesService {
  constructor(private readonly db: DataSource, private readonly store: ObjectStore) {}

  /** object key for GET /images/:imageId/:size — product gallery images and category banners share one URL space */
  async objectKey(imageId: string, size: ImageSize) {
    const [r] = await this.db.query(
      `SELECT object_prefix FROM product_images WHERE id = $1 UNION ALL SELECT object_prefix FROM category_images WHERE image_id = $1 LIMIT 1`,
      [imageId],
    );
    return r ? `${r.object_prefix}/${size}.webp` : null;
  }

  async open(imageId: string, size: ImageSize) {
    const key = await this.objectKey(imageId, size);
    const obj = key ? await this.store.get(key) : null;
    if (!obj) throw new NotFoundException('Image not found');
    return obj;
  }

  async primaryUrl(productId: string, size: ImageSize) {
    const [r] = await this.db.query(`SELECT id FROM product_images WHERE product_id = $1 ORDER BY position LIMIT 1`, [productId]);
    if (!r) throw new NotFoundException('No image for this product');
    return imageUrl(r.id, size);
  }

  async categoryUrl(categoryId: string, size: ImageSize) {
    const [r] = await this.db.query(`SELECT image_id FROM category_images WHERE category_id = $1`, [categoryId]);
    if (!r) throw new NotFoundException('No image for this category');
    return imageUrl(r.image_id, size);
  }

  async list(productId: string) {
    const rows = await this.db.query(`SELECT id, position, alt, width, height, attribution FROM product_images WHERE product_id = $1 ORDER BY position`, [productId]);
    return rows.map(toProductImage);
  }

  /** locks the product row; 404 if missing, 403 NOT_OWNER unless creator or registered brand owner */
  private async lockOwned(tx: EntityManager, productId: string, sub: string) {
    const [p] = await tx.query(`SELECT id, title, brand, created_by FROM products WHERE id = $1 FOR UPDATE`, [productId]);
    if (!p) throw new NotFoundException('Product not found');
    const [b] = await tx.query(`SELECT owner_seller_id FROM brands WHERE lower(name) = lower($1)`, [p.brand]);
    if (!canManageImages({ createdBy: p.created_by }, b?.owner_seller_id ?? null, sub))
      throw rejection(new ImageError('NOT_OWNER', 'Only the seller who created this product or the brand owner can change its images.'));
    return p as { id: string; title: string };
  }

  /** ownership check before the upload body is read (cheap rejection, no processing) */
  async assertOwner(productId: string, sub: string) {
    await this.db.transaction((tx) => this.lockOwned(tx, productId, sub));
  }

  async add(productId: string, sub: string, file: Buffer) {
    let img: ProcessedImage;
    try {
      img = await processImage(file);
    } catch (e) {
      throw e instanceof ImageError ? rejection(e) : e;
    }
    const id = randomUUID();
    const prefix = productPrefix(productId, id);
    // bytes first (unreferenced objects are harmless), then the row; the row lock serialises the 5-image limit
    let written = false;
    try {
      return await this.db.transaction(async (tx) => {
        const p = await this.lockOwned(tx, productId, sub);
        const [c] = await tx.query(`SELECT count(*)::int AS n, coalesce(max(position) + 1, 0) AS next FROM product_images WHERE product_id = $1`, [productId]);
        if (c.n >= MAX_IMAGES_PER_PRODUCT) throw rejection(new ImageError('TOO_MANY_IMAGES', `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images — delete one first.`));
        for (const [size, buf] of Object.entries(img.variants)) await this.store.put(`${prefix}/${size}.webp`, buf);
        written = true;
        const [row] = await tx.query(
          `INSERT INTO product_images (id, product_id, position, object_prefix, width, height, alt, source, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'seller', $8) RETURNING id, position, alt, width, height, attribution`,
          [id, productId, Number(c.next), prefix, img.width, img.height, p.title, sub],
        );
        return toProductImage(row);
      });
    } catch (e) {
      if (written) await this.store.deletePrefix(`${prefix}/`);
      throw e;
    }
  }

  async remove(productId: string, sub: string, imageId: string) {
    const prefix = await this.db.transaction(async (tx) => {
      await this.lockOwned(tx, productId, sub);
      // TypeORM returns [rows, affected] for DELETE … RETURNING
      const [rows] = await tx.query(`DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING object_prefix`, [imageId, productId]);
      if (!rows?.length) throw new NotFoundException('Image not found');
      await tx.query(
        `UPDATE product_images i SET position = r.rn - 1 FROM (SELECT id, row_number() OVER (ORDER BY position) AS rn FROM product_images WHERE product_id = $1) r
          WHERE i.id = r.id`,
        [productId],
      );
      return rows[0].object_prefix as string;
    });
    // stock photos (stock/<hash>) are shared by many products and owned by the seed — only seller uploads are deleted
    if (prefix.startsWith('products/')) await this.store.deletePrefix(`${prefix}/`);
  }

  async reorder(productId: string, sub: string, imageIds: string[]) {
    await this.db.transaction(async (tx) => {
      await this.lockOwned(tx, productId, sub);
      const current: { id: string }[] = await tx.query(`SELECT id FROM product_images WHERE product_id = $1`, [productId]);
      const have = new Set(current.map((r) => r.id));
      if (imageIds.length !== have.size || new Set(imageIds).size !== imageIds.length || imageIds.some((id) => !have.has(id)))
        throw new BadRequestException('imageIds must list every image of this product exactly once');
      for (const [i, id] of imageIds.entries()) await tx.query(`UPDATE product_images SET position = $2 WHERE id = $1`, [id, i]);
    });
    return { images: await this.list(productId) };
  }
}
