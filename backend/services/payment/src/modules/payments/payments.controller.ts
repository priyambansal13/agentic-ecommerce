import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { PaymentCreateInputSchema, TestPayInputSchema } from '@ac/contracts';
import { Principal, type PrincipalInfo, Public, Roles, ZodPipe } from '@ac/nest-common';
import { z } from 'zod';
import { PaymentsService } from './payments.service.js';

const RefundInputSchema = z.object({ refundCaseId: z.uuid(), orderId: z.uuid(), amountMinor: z.int().positive(), reason: z.string().trim().min(2).max(200) });

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** POST /v1/internal/payments — order service (checkout saga), idempotent on orderId */
  @Roles('service')
  @Post('internal/payments')
  @HttpCode(201)
  create(@Body(new ZodPipe(PaymentCreateInputSchema)) body: z.infer<typeof PaymentCreateInputSchema>) {
    return this.payments.create(body);
  }

  /** POST /v1/internal/refunds — returns service / refund agent; idempotent on refundCaseId, Σrefunds ≤ captured */
  @Roles('service')
  @Post('internal/refunds')
  @HttpCode(201)
  refund(@Principal() p: PrincipalInfo, @Body(new ZodPipe(RefundInputSchema)) body: z.infer<typeof RefundInputSchema>) {
    return this.payments.refund(body, p);
  }

  /** GET /v1/payments/:id — the buyer who owns it (pay page) */
  @Roles('buyer', 'seller', 'admin', 'support')
  @Get('payments/:id')
  view(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.view(id, p);
  }

  /** POST /v1/payments/:id/testpay — pay with a TEST card (no real money); result arrives by signed webhook */
  @Roles('buyer', 'seller')
  @Post('payments/:id/testpay')
  @HttpCode(202)
  testpay(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(TestPayInputSchema)) body: z.infer<typeof TestPayInputSchema>) {
    return this.payments.submitTestCard(id, p, body);
  }

  /** POST /v1/webhooks/testpay|stripe — signature over the RAW body; deduped on the provider event id */
  @Public()
  @Post('webhooks/testpay')
  @HttpCode(200)
  testpayWebhook(@Req() req: { rawBody?: string }, @Headers('testpay-signature') sig?: string) {
    return this.payments.webhook('testpay', req.rawBody, sig);
  }

  @Public()
  @Post('webhooks/stripe')
  @HttpCode(200)
  stripeWebhook(@Req() req: { rawBody?: string }, @Headers('stripe-signature') sig?: string) {
    return this.payments.webhook('stripe', req.rawBody, sig);
  }
}
