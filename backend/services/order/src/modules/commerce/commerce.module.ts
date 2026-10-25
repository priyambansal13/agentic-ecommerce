import { Module } from '@nestjs/common';
import { CartService } from './cart.service.js';
import { CheckoutService } from './checkout.service.js';
import { CommerceClients } from './clients.js';
import { CartController, CheckoutController } from './commerce.controller.js';
import { LifecycleService } from './lifecycle.service.js';
import { OrderRepo } from './order.repo.js';

@Module({
  controllers: [CartController, CheckoutController],
  providers: [CommerceClients, CartService, CheckoutService, LifecycleService, OrderRepo],
})
export class CommerceModule {}
