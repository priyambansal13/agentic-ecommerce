import { Module } from '@nestjs/common';
import { OrderEventsConsumer } from './order-events.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { StripeProvider, TestpayProvider } from './providers.js';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    OrderEventsConsumer,
    { provide: TestpayProvider, useFactory: () => new TestpayProvider() },
    { provide: StripeProvider, useFactory: () => new StripeProvider() },
  ],
})
export class PaymentsModule {}
