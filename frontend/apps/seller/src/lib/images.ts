import 'server-only';
import { sendForm } from '@ac/bff';

/** Non-empty image files from the picker (browsers send an empty part when nothing is chosen). */
export const imageFiles = (fd: FormData) => fd.getAll('images').filter((f): f is File => typeof f === 'object' && f !== null && 'size' in f && (f as File).size > 0).slice(0, 5);

/** Upload photos one by one to catalog (it validates type/size/dimensions and re-encodes); returns per-file errors. */
export async function uploadImages(productId: string, files: File[]): Promise<string[]> {
  const failed: string[] = [];
  for (const f of files) {
    const form = new FormData();
    form.append('file', f, f.name);
    const r = await sendForm('POST', `/api/catalog/v1/products/${productId}/images`, form);
    if (!r.ok) failed.push(`${f.name}: ${IMAGE_ERRORS[r.code ?? ''] ?? r.error}`);
  }
  return failed;
}
const IMAGE_ERRORS: Record<string, string> = {
  NOT_OWNER: 'only the product creator or brand owner can change photos',
  TOO_MANY_IMAGES: 'a product can have at most 5 photos',
  UNSUPPORTED_TYPE: 'use JPEG, PNG or WebP',
  TOO_LARGE: 'larger than 5 MB',
  TOO_SMALL: 'at least 500 px on the shortest side',
};
