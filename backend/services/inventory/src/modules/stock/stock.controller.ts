import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ReservationInputSchema, StockAdjustInputSchema } from '@ac/contracts';
import { Principal, type PrincipalInfo, Public, Roles, ZodPipe } from '@ac/nest-common';
import type { z } from 'zod';
import { StockService } from './stock.service.js';

/** Internal reservation API (Order service, realm role `service`) + public display stock + seller stock edits. */
@Controller()
export class StockController {
  constructor(private readonly stock: StockService) {}

  /** POST /v1/internal/reservations — all-or-nothing, idempotent on orderId; 409 INSUFFICIENT_STOCK {skuIds} */
  @Roles('service')
  @Post('internal/reservations')
  @HttpCode(201)
  reserve(@Body(new ZodPipe(ReservationInputSchema)) b: z.infer<typeof ReservationInputSchema>) {
    return this.stock.reserve(b.orderId, b.lines, b.ttlSec);
  }

  @Roles('service')
  @Get('internal/reservations/:orderId')
  get(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.stock.get(orderId);
  }

  @Roles('service')
  @Post('internal/reservations/:orderId/commit')
  @HttpCode(200)
  async commit(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return (await this.stock.commit(orderId)) ?? this.stock.get(orderId);
  }

  @Roles('service')
  @Post('internal/reservations/:orderId/release')
  @HttpCode(200)
  async release(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return (await this.stock.release(orderId, 'ORDER_CANCELLED')) ?? this.stock.get(orderId);
  }

  /** GET /v1/stock?skuIds=a,b — display only ("In stock", "Only 3 left"); decisions use reservations */
  @Public()
  @Get('stock')
  levels(@Query('skuIds') skuIds?: string) {
    return this.stock.levels(skuIds);
  }

  /** PUT /v1/sellers/me/stock/:skuId { onHand } — restock / correct my own SKU */
  @Roles('seller')
  @Put('sellers/me/stock/:skuId')
  adjust(@Principal() p: PrincipalInfo, @Param('skuId', ParseUUIDPipe) skuId: string, @Body(new ZodPipe(StockAdjustInputSchema)) b: z.infer<typeof StockAdjustInputSchema>) {
    return this.stock.adjust(p.sub, skuId, b.onHand);
  }
}
