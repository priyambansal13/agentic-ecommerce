import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type DecisionInput, ModerationDecisionInputSchema } from '@ac/contracts';
import { Principal, type PrincipalInfo, Roles, ZodPipe } from '@ac/nest-common';
import { ModerationService } from './moderation.service.js';

@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  /** POST /v1/moderation/:itemId/decision { decision, note, version } */
  @Roles('moderator', 'admin')
  @Post(':itemId/decision')
  @HttpCode(200)
  decide(@Principal() p: PrincipalInfo, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(ModerationDecisionInputSchema)) d: DecisionInput) {
    return this.moderation.decide(itemId, d, p.sub);
  }
}
