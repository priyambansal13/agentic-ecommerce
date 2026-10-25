import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { canManageImages, detectImageType, ImageError, processImage } from './image-processing.js';

const solid = (w: number, h: number, fmt: 'png' | 'jpeg' | 'webp' = 'png') =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } })[fmt]().toBuffer();
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ImageError ? e.code : `other: ${(e as Error).message}`));

describe('detectImageType (magic bytes)', () => {
  it('recognises jpeg, png and webp regardless of name or declared type', async () => {
    expect(detectImageType(await solid(10, 10, 'jpeg'))).toBe('jpeg');
    expect(detectImageType(await solid(10, 10, 'png'))).toBe('png');
    expect(detectImageType(await solid(10, 10, 'webp'))).toBe('webp');
  });
  it('rejects anything else', () => {
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageType(Buffer.alloc(2))).toBeNull();
  });
});

describe('processImage', () => {
  it('re-encodes to WebP at thumb/card/full without upscaling and strips metadata', async () => {
    const withExif = await sharp(await solid(1200, 800, 'jpeg')).withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } }).jpeg().toBuffer();
    const r = await processImage(withExif);
    expect([r.width, r.height]).toEqual([1200, 800]);
    const dims = await Promise.all(Object.values(r.variants).map((b) => sharp(b).metadata()));
    expect(dims.map((m) => [m.format, m.width, m.height])).toEqual([['webp', 160, 107], ['webp', 400, 267], ['webp', 1000, 667]]);
    expect(dims.every((m) => !m.exif)).toBe(true);
    const small = await processImage(await solid(600, 500));
    expect((await sharp(small.variants.full).metadata()).width).toBe(600); // never enlarged
  });
  it('rejects too small, too large and unsupported files', async () => {
    expect(await code(processImage(await solid(499, 900)))).toBe('TOO_SMALL');
    expect(await code(processImage(await solid(800, 800), { maxBytes: 100 }))).toBe('TOO_LARGE');
    expect(await code(processImage(Buffer.from('%PDF-1.7 not an image')))).toBe('UNSUPPORTED_TYPE');
    // right magic bytes, broken body
    expect(await code(processImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)])))).toBe('UNSUPPORTED_TYPE');
  });
});

describe('canManageImages', () => {
  const creator = 'a0000000-0000-4000-8000-000000000001';
  const owner = 'b0000000-0000-4000-8000-000000000002';
  const other = 'c0000000-0000-4000-8000-000000000003';
  it('allows the creator and the registered brand owner, nobody else', () => {
    expect(canManageImages({ createdBy: creator }, null, creator)).toBe(true);
    expect(canManageImages({ createdBy: creator }, owner, owner)).toBe(true);
    expect(canManageImages({ createdBy: creator }, owner, other)).toBe(false);
    expect(canManageImages({ createdBy: null }, null, other)).toBe(false);
  });
});
