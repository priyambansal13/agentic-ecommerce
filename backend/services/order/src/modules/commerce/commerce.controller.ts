import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import { CancelInputSchema, CartItemInputSchema, CartQtyInputSchema, type CheckoutInput, CheckoutInputSchema, ShipInputSchema } from '@ac/contracts';
import { Idempotent, Principal, type PrincipalInfo, Public, Roles, verifyBearer, ZodPipe } from '@ac/nest-common';
import type { z } from 'zod';
import { type CartOwner, CartService, guestOwner } from './cart.service.js';
import { CheckoutService } from './checkout.service.js';
import { LifecycleService } from './lifecycle.service.js';

/**
 * Cart works for guests and signed-in customers: with a customers-realm bearer token the cart is the buyer's
 * (Postgres), otherwise the guest cart named by `X-Cart-Session` (Redis). The zone BFF owns the session cookie.
 */
async function ownerOf(auth: string | undefined, sid: string | undefined): Promise<CartOwner> {
  if (auth) {
    const p = await verifyBearer(auth);
    if (p.realm !== 'customers') throw new UnauthorizedException('carts belong to customer accounts');
    return { kind: 'buyer', id: p.sub };
  }
  return guestOwner(sid);
}

@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Public()
  @Get()
  async get(@Headers('authorization') auth?: string, @Headers('x-cart-session') sid?: string) {
    return this.cart.view(await ownerOf(auth, sid));
  }

  @Public()
  @Post('items')
  @HttpCode(200)
  async add(@Body(new ZodPipe(CartItemInputSchema)) b: z.infer<typeof CartItemInputSchema>, @Headers('authorization') auth?: string, @Headers('x-cart-session') sid?: string) {
    return this.cart.add(await ownerOf(auth, sid), b.offerId, b.qty);
  }

  @Public()
  @Patch('items/:offerId')
  async qty(@Param('offerId', ParseUUIDPipe) offerId: string, @Body(new ZodPipe(CartQtyInputSchema)) b: z.infer<typeof CartQtyInputSchema>, @Headers('authorization') auth?: string, @Headers('x-cart-session') sid?: string) {
    return this.cart.setQty(await ownerOf(auth, sid), offerId, b.qty);
  }

  @Public()
  @Delete('items/:offerId')
  async remove(@Param('offerId', ParseUUIDPipe) offerId: string, @Headers('authorization') auth?: string, @Headers('x-cart-session') sid?: string) {
    return this.cart.delete(await ownerOf(auth, sid), offerId);
  }

  /** POST /v1/cart/merge — after sign-in: move the guest cart (X-Cart-Session) into the buyer's cart */
  @Roles('buyer', 'seller')
  @Post('merge')
  @HttpCode(200)
  merge(@Principal() p: PrincipalInfo, @Headers('x-cart-session') sid?: string) {
    return this.cart.merge(p.sub, sid ?? '');
  }
}

@Controller()
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService, private readonly lifecycle: LifecycleService) {}

  /** POST /v1/checkout — saga: re-price → order → risk → reserve → payment session (Idempotency-Key required) */
  @Roles('buyer')
  @Idempotent()
  @Post('checkout')
  @HttpCode(201)
  placeOrder(@Principal() p: PrincipalInfo, @Body(new ZodPipe(CheckoutInputSchema)) b: CheckoutInput) {
    return this.checkout.checkout(p, b);
  }

  /** GET /v1/orders/:id — id or order number; the buyer who placed it, or admin/support */
  @Roles('buyer', 'seller', 'admin', 'support')
  @Get('orders/:id')
  detail(@Principal() p: PrincipalInfo, @Param('id') id: string) {
    return this.lifecycle.detail(p, id);
  }

  /** POST /v1/orders/:id/cancel — buyer, before anything shipped (refund owed if it was paid) */
  @Roles('buyer')
  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@Principal() p: PrincipalInfo, @Param('id') id: string, @Body(new ZodPipe(CancelInputSchema)) b: z.infer<typeof CancelInputSchema>) {
    return this.lifecycle.cancel(p, id, b.reason);
  }

  /** GET /v1/sellers/me/orders?status=OPEN|CONFIRMED (= OPEN)|PENDING_PAYMENT|SHIPPED|DELIVERED|CANCELLED|ALL; anything else → 400 */
  @Roles('seller')
  @Get('sellers/me/orders')
  sellerOrders(@Principal() p: PrincipalInfo, @Query('status') status?: string) {
    return this.lifecycle.sellerOrders(p.sub, status?.toUpperCase());
  }

  /** POST /v1/seller-orders/:id/ship { carrier, trackingNo } — the seller who owns it */
  @Roles('seller')
  @Post('seller-orders/:id/ship')
  @HttpCode(200)
  ship(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ShipInputSchema)) b: z.infer<typeof ShipInputSchema>) {
    return this.lifecycle.ship(p, id, b.carrier, b.trackingNo);
  }
}
