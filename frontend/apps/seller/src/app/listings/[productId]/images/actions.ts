'use server';
import { send } from '@ac/bff';
import { redirect } from 'next/navigation';
import { imageFiles, uploadImages } from '../../../../lib/images';
import { flash, str } from '../../../../lib/seller';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const back = (id: string) => `/listings/${id}/images`;

/** Upload more photos (catalog validates owner, count, type, size, dimensions). */
export async function addImages(fd: FormData) {
  const id = str(fd.get('productId'));
  if (!UUID.test(id)) redirect(flash('/listings', 'err', 'Unknown product.'));
  const files = imageFiles(fd);
  if (!files.length) redirect(flash(back(id), 'err', 'Choose at least one photo.'));
  const failed = await uploadImages(id, files);
  const added = files.length - failed.length;
  redirect(failed.length ? flash(back(id), 'err', `${added ? `${added} added. ` : ''}${failed.join(' · ')}`) : flash(back(id), 'ok', `${added} photo${added > 1 ? 's' : ''} added.`));
}

export async function deleteImage(fd: FormData) {
  const id = str(fd.get('productId'));
  const imageId = str(fd.get('imageId'));
  if (!UUID.test(id) || !UUID.test(imageId)) redirect(flash('/listings', 'err', 'Unknown image.'));
  const r = await send('DELETE', `/api/catalog/v1/products/${id}/images/${imageId}`);
  redirect(r.ok ? flash(back(id), 'ok', 'Photo removed.') : flash(back(id), 'err', r.error));
}

/** Reorder: `order` = comma-separated image ids, first = main image. */
export async function reorderImages(fd: FormData) {
  const id = str(fd.get('productId'));
  const imageIds = str(fd.get('order')).split(',').filter((x) => UUID.test(x));
  if (!UUID.test(id) || !imageIds.length) redirect(flash('/listings', 'err', 'Unknown product.'));
  const r = await send('PUT', `/api/catalog/v1/products/${id}/images/order`, { imageIds });
  redirect(r.ok ? flash(back(id), 'ok', 'Order saved — the first photo is the main image.') : flash(back(id), 'err', r.error));
}
