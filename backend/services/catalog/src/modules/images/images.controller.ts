import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res } from '@nestjs/common';
import { ImageOrderInputSchema, ImageSize } from '@ac/contracts';
import { Principal, type PrincipalInfo, Public, Roles, ZodPipe } from '@ac/nest-common';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ImageError, MAX_IMAGE_BYTES } from './image-processing.js';
import { ImagesService, rejection } from './images.service.js';

const SizePipe = new ZodPipe(ImageSize);
/** @fastify/multipart decorations (registered in main.ts) */
type MultipartRequest = FastifyRequest & { isMultipart(): boolean; file(opts?: { limits?: { fileSize?: number; files?: number } }): Promise<MultipartFile | undefined> };
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Product images. Public GETs are cacheable by browsers/CDN: image bytes are immutable per imageId (a new upload
 * gets a new id); "primary" and category URLs are short-lived redirects to them.
 */
@Controller()
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  /** GET /v1/images/:imageId/:size — WebP bytes */
  @Public()
  @Get('images/:imageId/:size')
  async image(@Param('imageId', ParseUUIDPipe) id: string, @Param('size', SizePipe) size: ImageSize, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const etag = `"${id}-${size}"`;
    if (req.headers['if-none-match'] === etag) return reply.status(304).header('etag', etag).header('cache-control', IMMUTABLE).send();
    const obj = await this.images.open(id, size);
    reply.header('content-type', 'image/webp').header('cache-control', IMMUTABLE).header('etag', etag).header('x-content-type-options', 'nosniff');
    if (obj.length) reply.header('content-length', obj.length);
    return reply.send(obj.body);
  }

  /** GET /v1/products/:productId/image/:size — 302 to the primary image, 404 when the product has none */
  @Public()
  @Get('products/:productId/image/:size')
  async primary(@Param('productId', ParseUUIDPipe) id: string, @Param('size', SizePipe) size: ImageSize, @Res() reply: FastifyReply) {
    const url = await this.images.primaryUrl(id, size);
    return reply.header('cache-control', 'public, max-age=300').redirect(url, 302);
  }

  /** GET /v1/categories/:id/image/:size — 302 to the category banner */
  @Public()
  @Get('categories/:id/image/:size')
  async category(@Param('id') id: string, @Param('size', SizePipe) size: ImageSize, @Res() reply: FastifyReply) {
    const url = await this.images.categoryUrl(id, size);
    return reply.header('cache-control', 'public, max-age=3600').redirect(url, 302);
  }

  /** POST /v1/products/:productId/images — multipart field `file` (JPEG/PNG/WebP ≤ 5 MB, ≥ 500 px), creator or brand owner */
  @Roles('seller')
  @Post('products/:productId/images')
  async upload(@Principal() p: PrincipalInfo, @Param('productId', ParseUUIDPipe) id: string, @Req() req: MultipartRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send multipart/form-data with the image in field "file"');
    await this.images.assertOwner(id, p.sub);
    let buf: Buffer;
    try {
      const part = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
      if (!part || part.fieldname !== 'file') throw new BadRequestException('Missing multipart field "file"');
      buf = await part.toBuffer();
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw rejection(new ImageError('TOO_LARGE', 'Images must be 5 MB or smaller.'));
      throw e;
    }
    return this.images.add(id, p.sub, buf);
  }

  @Roles('seller')
  @Delete('products/:productId/images/:imageId')
  @HttpCode(204)
  async remove(@Principal() p: PrincipalInfo, @Param('productId', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    await this.images.remove(id, p.sub, imageId);
  }

  /** PUT /v1/products/:productId/images/order { imageIds } — first is the primary image */
  @Roles('seller')
  @Put('products/:productId/images/order')
  reorder(@Principal() p: PrincipalInfo, @Param('productId', ParseUUIDPipe) id: string, @Body(new ZodPipe(ImageOrderInputSchema)) body: { imageIds: string[] }) {
    return this.images.reorder(id, p.sub, body.imageIds);
  }
}
