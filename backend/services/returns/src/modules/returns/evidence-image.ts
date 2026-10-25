import sharp, { type Metadata } from 'sharp';

/**
 * Evidence photos (buyer uploads): JPEG/PNG/WebP ≤ 8 MB, re-encoded to WebP (max 1600 px + 320 px thumb), auto-rotated,
 * EXIF/GPS stripped. Small pure helpers copied from catalog's image-processing (no cross-service imports).
 * Findings are SIGNALS for the policy/agent (perceptual hash for reused photos), never decisions.
 */
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const MIN_EVIDENCE_SIDE = 200;
export const MAX_PHOTOS_PER_CASE = 5;

export class EvidenceError extends Error {
  constructor(readonly code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'TOO_SMALL' | 'TOO_MANY', message: string) {
    super(message);
  }
}

export function detectImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** 64-bit difference hash (9×8 greyscale) as 16 hex chars — near-identical photos have a small Hamming distance. */
export async function dHash(buf: Buffer): Promise<string> {
  const px = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export interface ProcessedEvidence {
  width: number;
  height: number;
  hadExif: boolean;
  dhash: string;
  full: Buffer;
  thumb: Buffer;
}

export async function processEvidence(buf: Buffer): Promise<ProcessedEvidence> {
  if (buf.length > MAX_EVIDENCE_BYTES) throw new EvidenceError('TOO_LARGE', 'Photos must be 8 MB or smaller.');
  if (!detectImageType(buf)) throw new EvidenceError('UNSUPPORTED_TYPE', 'Upload a JPEG, PNG or WebP photo.');
  let meta: Metadata;
  try {
    meta = await sharp(buf, { failOn: 'error' }).metadata();
  } catch {
    throw new EvidenceError('UNSUPPORTED_TYPE', 'The file is not a readable image.');
  }
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  if (Math.min(width, height) < MIN_EVIDENCE_SIDE) throw new EvidenceError('TOO_SMALL', `Photos must be at least ${MIN_EVIDENCE_SIDE} px on each side.`);
  const full = await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const thumb = await sharp(buf).rotate().resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
  return { width, height, hadExif: Boolean(meta.exif), dhash: await dHash(buf), full, thumb };
}
