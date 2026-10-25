import { Controller, Get, Query } from '@nestjs/common';
import { Principal, type PrincipalInfo, Roles, ZodPipe } from '@ac/nest-common';
import { type MyOrdersQuery, MyOrdersQuerySchema } from './orders.query.js';
import { OrdersService } from './orders.service.js';

/** Buyer order history ("Your Orders", "Buy Again") — always scoped to the caller. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** GET /v1/orders/mine?tab=all|not-shipped|cancelled&range=3m|6m|12m&page=1 */
  @Roles('buyer')
  @Get('mine')
  mine(@Principal() p: PrincipalInfo, @Query(new ZodPipe(MyOrdersQuerySchema)) q: MyOrdersQuery) {
    return this.orders.mine(p.sub, q);
  }

  /** GET /v1/orders/mine/buy-again — delivered products, most re-ordered first */
  @Roles('buyer')
  @Get('mine/buy-again')
  buyAgain(@Principal() p: PrincipalInfo) {
    return this.orders.buyAgain(p.sub);
  }
}
