import sharp, { type Metadata } from 'sharp';
import type { ImageSize } from '@ac/contracts';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_IMAGE_SIDE = 500;
export const MAX_IMAGES_PER_PRODUCT = 5;
/** longest side in px per served size (never upscaled) */
export const SIZES: Record<ImageSize, number> = { thumb: 160, card: 400, full: 1000 };

export type ImageErrorCode = 'NOT_OWNER' | 'TOO_MANY_IMAGES' | 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'TOO_SMALL';
export class ImageError extends Error {
  constructor(readonly code: ImageErrorCode, message: string) {
    super(message);
  }
}

/** Sniff the real type from magic bytes — never trust the filename or the declared Content-Type. */
export function detectImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export interface ProcessedImage {
  width: number;
  height: number;
  variants: Record<ImageSize, Buffer>;
}

/**
 * Validate and re-encode an image: JPEG/PNG/WebP only, ≤ 5 MB, shortest side ≥ 500 px (`minSide` 0 for trusted
 * stock photos already checked at curation). Output: WebP per size, auto-rotated, metadata (EXIF/GPS) stripped.
 */
export async function processImage(buf: Buffer, opts: { minSide?: number; maxBytes?: number } = {}): Promise<ProcessedImage> {
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  if (buf.length > maxBytes) throw new ImageError('TOO_LARGE', `Images must be ${Math.round(maxBytes / 1048576)} MB or smaller.`);
  if (!detectImageType(buf)) throw new ImageError('UNSUPPORTED_TYPE', 'Upload a JPEG, PNG or WebP image.');
  let meta: Metadata;
  try {
    meta = await sharp(buf, { failOn: 'error' }).metadata();
  } catch {
    throw new ImageError('UNSUPPORTED_TYPE', 'The file is not a readable image.');
  }
  // EXIF orientations 5–8 swap width and height
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  const minSide = opts.minSide ?? MIN_IMAGE_SIDE;
  if (Math.min(width, height) < minSide) throw new ImageError('TOO_SMALL', `Images must be at least ${minSide} × ${minSide} px (this one is ${width} × ${height}).`);
  const variants = {} as Record<ImageSize, Buffer>;
  for (const [size, px] of Object.entries(SIZES) as [ImageSize, number][]) {
    variants[size] = await sharp(buf).rotate().resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true }).webp({ quality: size === 'thumb' ? 70 : 80 }).toBuffer();
  }
  return { width, height, variants };
}

/** Who may change a product's images: the seller who created it, or the owner of its registered brand. */
export function canManageImages(product: { createdBy: string | null }, brandOwnerId: string | null, sub: string): boolean {
  return product.createdBy === sub || (brandOwnerId !== null && brandOwnerId === sub);
}
