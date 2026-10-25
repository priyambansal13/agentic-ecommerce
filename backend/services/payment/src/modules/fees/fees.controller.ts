import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { FeePreviewInputSchema, FeeScheduleUpdateSchema } from '@ac/contracts';
import { Principal, type PrincipalInfo, Public, Roles, ZodPipe } from '@ac/nest-common';
import { z } from 'zod';
import { type Actor, FeesService, type ScheduleUpdate } from './fees.service.js';

const DecideBody = z.object({ note: z.string().trim().max(500).optional() }).default({});

/** Display name from the (already verified) token; maker-checker compares the stable `sub`. */
function actor(p: PrincipalInfo): Actor {
  try {
    const claims = JSON.parse(Buffer.from(p.token.split('.')[1], 'base64url').toString('utf8'));
    return { id: p.sub, name: String(claims.preferred_username ?? claims.name ?? p.sub) };
  } catch {
    return { id: p.sub, name: p.sub };
  }
}

@Controller()
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  /** GET /v1/fees/schedule — the ACTIVE schedule (public: sellers see what they will pay) */
  @Public()
  @Get('fees/schedule')
  active() {
    return this.fees.activeView();
  }

  /** POST /v1/fees/preview { category, priceMinor, quantity } */
  @Public()
  @Post('fees/preview')
  @HttpCode(200)
  preview(@Body(new ZodPipe(FeePreviewInputSchema)) b: z.infer<typeof FeePreviewInputSchema>) {
    return this.fees.preview(b.category, b.priceMinor, b.quantity);
  }

  @Roles('finance', 'admin')
  @Get('fees/schedules')
  list() {
    return this.fees.list();
  }

  @Roles('finance')
  @Post('fees/schedules')
  create(@Principal() p: PrincipalInfo) {
    return this.fees.createDraft(actor(p));
  }

  @Roles('finance')
  @Put('fees/schedules/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(FeeScheduleUpdateSchema)) b: ScheduleUpdate) {
    return this.fees.update(id, b);
  }

  @Roles('finance')
  @Post('fees/schedules/:id/submit')
  @HttpCode(200)
  submit(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.fees.submit(id, actor(p));
  }

  @Roles('finance', 'admin')
  @Post('fees/schedules/:id/approve')
  @HttpCode(200)
  approve(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DecideBody)) b: z.infer<typeof DecideBody>) {
    return this.fees.decide(id, true, actor(p), b.note);
  }

  @Roles('finance', 'admin')
  @Post('fees/schedules/:id/reject')
  @HttpCode(200)
  reject(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DecideBody)) b: z.infer<typeof DecideBody>) {
    return this.fees.decide(id, false, actor(p), b.note);
  }

  /** GET /v1/sellers/me/fees — fees on my sales, last 30 days */
  @Roles('seller')
  @Get('sellers/me/fees')
  mine(@Principal() p: PrincipalInfo) {
    return this.fees.sellerFees(p.sub);
  }
}
