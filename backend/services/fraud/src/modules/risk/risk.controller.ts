import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RiskInputSchema } from '@ac/contracts';
import { Roles, ZodPipe } from '@ac/nest-common';
import type { z } from 'zod';
import { RiskService } from './risk.service.js';

@Controller('internal/risk')
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  /** POST /v1/internal/risk/score — Order service during checkout (callers time out at 300 ms → REVIEW);
   *  purpose=refund: read-only lookup by the refund agent */
  @Roles('service')
  @Post('score')
  @HttpCode(200)
  score(@Body(new ZodPipe(RiskInputSchema)) b: z.infer<typeof RiskInputSchema>) {
    return this.risk.score(b);
  }
}
